#!/usr/bin/env node

import { program } from "commander";
import ora from "ora";
import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";
import os from "os";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { GoogleGenAI } from "@google/genai";

const CONFIG_PATH = path.join(os.homedir(), ".env-harvester-config.json");

/**
 * Helper to load the saved API Key
 */
async function getSavedApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  try {
    const configData = await fs.readFile(CONFIG_PATH, "utf-8");
    const json = JSON.parse(configData);
    return json.geminiApiKey || null;
  } catch {
    return null;
  }
}

/**
 * Helper to save the API Key globally
 */
async function saveApiKey(key) {
  try {
    await fs.writeFile(CONFIG_PATH, JSON.stringify({ geminiApiKey: key.trim() }, null, 2), "utf-8");
  } catch (err) {
    console.error("\x1b[31mFailed to save API key to configuration file.\x1b[0m", err);
  }
}

/**
 * Helper to parse environment keys from an existing file content string
 */
function parseExistingKeys(content) {
  const keys = new Set();
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (trimmed && !trimmed.startsWith("#")) {
      const match = trimmed.match(/^([^=:\s]+)\s*=/);
      if (match) {
        keys.add(match[1].trim());
      }
    }
  }
  return keys;
}

program
  .name("env-harvester")
  .description("Auto-generates and incrementally updates .env and .env.example files")
  .version("1.1.0")
  .action(async () => {
    const rl = readline.createInterface({ input, output });

    try {
      let apiKey = await getSavedApiKey();
      let choice = "";

      // ---------------------------------------------------------
      // INTERACTIVE MENU LOOP
      // ---------------------------------------------------------
      while (true) {
        console.clear();
        console.log("\x1b[36m=== .Env Generator AI CLI ===\x1b[0m\n");

        if (!apiKey) {
          console.log("1. Generate / Update .env files (Simple / No AI)");
          console.log("2. Set Gemini API Key");
          console.log("3. Exit\n");
        } else {
          console.log("1. Generate / Update .env files (Smart AI Powered)");
          console.log("2. Change Gemini API Key");
          console.log("3. View current Gemini API Key");
          console.log("4. Exit\n");
        }

        const maxOptions = apiKey ? "4" : "3";
        choice = (await rl.question(`Select an option (1-${maxOptions}): `)).trim();

        if ((!apiKey && choice === "3") || (apiKey && choice === "4")) {
          console.log("Goodbye!");
          rl.close();
          process.exit(0);
        }

        if (choice === "2") {
          const newKey = await rl.question(
            apiKey ? "Enter New Gemini API Key: " : "Enter Gemini API Key: "
          );
          if (newKey.trim()) {
            await saveApiKey(newKey);
            apiKey = newKey.trim();
            console.log("\x1b[32mAPI Key saved successfully!\x1b[0m");
            await rl.question("\nPress Enter to return to menu...");
          }
          continue;
        }

        if (apiKey && choice === "3") {
          const keyLength = apiKey.length;
          const maskedKey = keyLength > 10 
            ? apiKey.slice(0, 5) + "*".repeat(keyLength - 10) + apiKey.slice(-5)
            : apiKey;

          console.log(`\n\x1b[33m--- Your Saved API Key ---\x1b[0m`);
          console.log(`Masked: \x1b[36m${maskedKey}\x1b[0m`);
          console.log(`Full:   \x1b[32m${apiKey}\x1b[0m`);
          console.log(`\x1b[33m--------------------------\x1b[0m`);
          
          await rl.question("\nPress Enter to return to menu...");
          continue;
        }

        if (choice === "1") {
          break;
        }

        console.log(`\x1b[31mInvalid option. Please choose a number between 1 and ${maxOptions}.\x1b[0m`);
        await rl.question("\nPress Enter to try again...");
      }

      rl.close();

      // ---------------------------------------------------------
      // CORE ENGINE EXECUTION
      // ---------------------------------------------------------
      const spinner = ora("Checking project environment...").start();

      let existingEnvContent = "";
      let existingExampleContent = "";
      let envKeys = new Set();
      let exampleKeys = new Set();

      try {
        existingEnvContent = await fs.readFile(".env", "utf-8");
        envKeys = parseExistingKeys(existingEnvContent);
      } catch (e) {}

      try {
        existingExampleContent = await fs.readFile(".env.example", "utf-8");
        exampleKeys = parseExistingKeys(existingExampleContent);
      } catch (e) {}

      // STEP A: Crawl Files
      spinner.text = "Crawling project directory...";
      const files = await fg(["**/*.{js,jsx,ts,tsx}"], {
        ignore: [
          "node_modules/**",
          ".git/**",
          "dist/**",
          "generated/**",
          "build/**",
          ".next/**",
          "coverage/**",
        ],
      });

      // STEP B: Extract Keys & Track Locations
      spinner.text = "Scanning files and tracking usage locations...";
      const envTracker = new Map();
      const explicitRegex = /(?:process\.env|import\.meta\.env)(?:\.|\[['"])([A-Z0-9_]+)(?:['"]\])?/g;

      for (const file of files) {
        const content = await fs.readFile(file, "utf-8");
        let match;
        while ((match = explicitRegex.exec(content)) !== null) {
          const key = match[1];
          if (!envTracker.has(key)) {
            envTracker.set(key, new Set());
          }
          envTracker.get(key).add(file);
        }
      }

      if (envTracker.size === 0) {
        spinner.succeed("No environment variables found in the codebase.");
        process.exit(0);
      }

      // Identify exactly what is missing globally
      const missingInEnv = [];
      const missingInExample = [];

      for (const key of envTracker.keys()) {
        if (!envKeys.has(key)) missingInEnv.push(key);
        if (!exampleKeys.has(key)) missingInExample.push(key);
      }

      // Gather a unique set of all keys requiring value/instruction synthesis
      const totalKeysToProcess = Array.from(new Set([...missingInEnv, ...missingInExample]));

      if (totalKeysToProcess.length === 0) {
        spinner.succeed("Both .env and .env.example are completely up to date with your codebase!");
        process.exit(0);
      }

      // STEP C: Process Contextual Data (AI vs Hardcoded Fallback) Only for Missing Keys
      let aiFallbacks = {};

      if (apiKey) {
        spinner.text = `Consulting AI to analyze ${totalKeysToProcess.length} newly discovered keys...`;
        const keysToAnalyze = totalKeysToProcess.join(", ");

        const prompt = `
          You are an expert developer onboarding assistant. I am giving you a list of environment variable keys newly added to a codebase: [${keysToAnalyze}].
          
          For each key, provide two fields in your JSON response:
          1. "value": A realistic, non-secret placeholder value or standard default fallback.
          2. "instructions": A beginner-friendly, click-by-click breakdown explaining exactly how to get this credential.

          CRITICAL RULES FOR "instructions":
          - Provide the exact website dashboard URL to open.
          - Give a literal, directional step path (e.g., "Go to Dashboard > Settings > API Keys").
          - Explain the final action needed to copy the string.
          - Do NOT write generic text like "Configure your database connection".
          
          Return ONLY a clean, valid JSON object matching the exact format layout below:
          {
            "PORT": { "value": "3000", "instructions": "Standard default port layout for local development setups." }
          }
        `;

        try {
          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" },
          });
          aiFallbacks = JSON.parse(response.text || "{}");
        } catch (aiError) {
          spinner.warn("AI generation failed. Falling back to simple default placeholders.");
        }
      } else {
        spinner.info("No Gemini key configured. Running structural incremental additions.");
        spinner.start("Syncing configuration entries...");
      }

      // Helper function to build content blocks cleanly
      const buildAppendString = (missingKeys, isNewFile) => {
        let block = "";
        if (isNewFile) {
          block += "# ------------------------------------------------------\n";
          block += `# Auto-generated environment variables by env-harvester\n`;
          block += "# ------------------------------------------------------\n\n";
        } else {
          block += "\n# ------------------------------------------------------\n";
          block += `# Incremental Updates Discovered On: ${new Date().toLocaleDateString()}\n`;
          block += "# ------------------------------------------------------\n\n";
        }

        for (const key of missingKeys) {
          const aiResponse = aiFallbacks[key];
          let finalValue = "your_value_here";
          let instructions = "Check provider documentation to generate this configuration value.";

          if (aiResponse && typeof aiResponse === "object") {
            finalValue = aiResponse.value || finalValue;
            instructions = aiResponse.instructions || instructions;
          }

          const fileSet = envTracker.get(key);
          const filesUsedIn = fileSet ? Array.from(fileSet) : [];
          block += `# Used in: ${filesUsedIn.join(", ")}\n`;
          block += `# How to get: ${instructions}\n`;
          block += `${key}=${finalValue}\n\n`;
        }
        return block;
      };

      // STEP D: Write or Append Incremental Blocks Uniquely per File Type
      spinner.text = "Applying updates to environment configuration files...";

      // Handle .env processing
      if (missingInEnv.length > 0) {
        const isNew = existingEnvContent.trim().length === 0;
        const appendData = buildAppendString(missingInEnv, isNew);
        // Ensure append formatting doesn't glue into text on lines missing terminal breaks
        const baseString = existingEnvContent.length > 0 && !existingEnvContent.endsWith("\n") 
          ? existingEnvContent + "\n" 
          : existingEnvContent;
        
        await fs.writeFile(".env", baseString + appendData, "utf-8");
      }

      // Handle .env.example processing
      if (missingInExample.length > 0) {
        const isNew = existingExampleContent.trim().length === 0;
        const appendData = buildAppendString(missingInExample, isNew);
        const baseString = existingExampleContent.length > 0 && !existingExampleContent.endsWith("\n") 
          ? existingExampleContent + "\n" 
          : existingExampleContent;

        await fs.writeFile(".env.example", baseString + appendData, "utf-8");
      }

      spinner.succeed(
        `Synchronization Complete! Added ${missingInEnv.length} new key(s) to .env and ${missingInExample.length} new key(s) to .env.example.`
      );
      process.exit(0);
    } catch (error) {
      spinner.fail("An unexpected system error occurred during configuration merge.");
      console.error(error);
      process.exit(1);
    }
  });

program.parse();