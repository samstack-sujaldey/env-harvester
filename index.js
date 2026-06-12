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

// Global configuration file path to persist the API key across terminal sessions
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

program
  .name("env-harvester")
  .description("Auto-generates .env and .env.example by scanning your codebase")
  .version("1.0.0")
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
          console.log("1. Generate .env files (Simple / No AI)");
          console.log("2. Set Gemini API Key");
          console.log("3. Exit\n");
        } else {
          console.log("1. Generate .env files (Smart AI Powered)");
          console.log("2. Change Gemini API Key");
          console.log("3. View current Gemini API Key");
          console.log("4. Exit\n");
        }

        const maxOptions = apiKey ? "4" : "3";
        choice = (await rl.question(`Select an option (1-${maxOptions}): `)).trim();

        // Handle Exit Action
        if ((!apiKey && choice === "3") || (apiKey && choice === "4")) {
          console.log("Goodbye!");
          rl.close();
          process.exit(0);
        }

        // Handle Set/Change Key Action
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
          continue; // Refresh menu layout
        }

        // Handle View Key Action
        if (apiKey && choice === "3") {
          const keyLength = apiKey.length;
          // Create a masked version (e.g., AIzaS*******************ABC)
          const maskedKey = keyLength > 10 
            ? apiKey.slice(0, 5) + "*".repeat(keyLength - 10) + apiKey.slice(-5)
            : apiKey;

          console.log(`\n\x1b[33m--- Your Saved API Key ---\x1b[0m`);
          console.log(`Masked: \x1b[36m${maskedKey}\x1b[0m`);
          console.log(`\x1b[33m--------------------------\x1b[0m`);
          
          await rl.question("\nPress Enter to return to menu...");
          continue;
        }

        // Handle Generate Action
        if (choice === "1") {
          break; // Break loop to proceed with generation engine below
        }

        // Handle Invalid Inputs
        console.log(`\x1b[31mInvalid option. Please choose a number between 1 and ${maxOptions}.\x1b[0m`);
        await rl.question("\nPress Enter to try again...");
      }

      rl.close(); // Close interface before spinner outputs start

      // ---------------------------------------------------------
      // CORE ENGINE EXECUTION
      // ---------------------------------------------------------
      const spinner = ora("Checking project environment...").start();

      let envExists = false;
      let envExampleExists = false;

      try {
        await fs.access(".env");
        envExists = true;
      } catch (e) {}

      try {
        await fs.access(".env.example");
        envExampleExists = true;
      } catch (e) {}

      // Rule 1: If both exist, do nothing and exit immediately
      if (envExists && envExampleExists) {
        spinner.succeed("Both .env and .env.example are already present. No changes made.");
        process.exit(0);
      }

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
        spinner.succeed("No environment variables found. You are all set!");
        process.exit(0);
      }

      // STEP C: Process Contextual Data (AI vs Hardcoded Fallback)
      let aiFallbacks = {};

      if (apiKey) {
        spinner.text = "Consulting AI to infer context and click-by-click steps...";
        const keysToAnalyze = Array.from(envTracker.keys()).join(", ");

        const prompt = `
          You are an expert developer onboarding assistant. I am giving you a list of environment variable keys found in a project codebase: [${keysToAnalyze}].
          
          For each key, provide two fields in your JSON response:
          1. "value": A realistic, non-secret placeholder value or standard default fallback.
          2. "instructions": A beginner-friendly, click-by-click breakdown explaining exactly how to get this credential.

          CRITICAL RULES FOR "instructions":
          - Provide the exact website dashboard URL to open.
          - Give a literal, directional step path (e.g., "Go to Dashboard > Settings > API Keys").
          - Explain the final action needed to copy the string.
          - Do NOT write generic text like "Configure your database connection" or "Register your app details".
          
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
          console.error("\n--- DEBUG AI ERROR ---", aiError);
          spinner.warn("AI generation failed. Using generic fallbacks instead.");
        }
      } else {
        spinner.info("No Gemini API key configured. Generating files with standard fallbacks.");
        spinner.start("Building environment configuration files...");
      }

      // STEP D: Build File Content String
      let envContent = "# ------------------------------------------------------\n";
      envContent += `# Auto-generated environment variables by env-harvester\n`;
      envContent += "# ------------------------------------------------------\n\n";

      for (const [key, fileSet] of envTracker.entries()) {
        const aiResponse = aiFallbacks[key];
        let finalValue = "your_value_here";
        let instructions = "Check provider documentation to generate this configuration value.";

        // Handle structural input differences gracefully
        if (aiResponse && typeof aiResponse === "object") {
          finalValue = aiResponse.value || finalValue;
          instructions = aiResponse.instructions || instructions;
        } else if (typeof aiResponse === "string") {
          finalValue = aiResponse;
        }

        const filesUsedIn = Array.from(fileSet);
        envContent += `# Used in: ${filesUsedIn.join(", ")}\n`;
        envContent += `# How to get: ${instructions}\n`;
        envContent += `${key}=${finalValue}\n\n`;
      }

      // STEP E: Write Files Safely According to Directory State Edge Cases
      spinner.text = "Writing configuration files...";

      if (envExists && !envExampleExists) {
        await fs.writeFile(".env.example", envContent, "utf-8");
        spinner.succeed(
          `Success! Harvested ${envTracker.size} variables. Created .env.example (Your existing .env was kept safe).`
        );
      } else if (!envExists && !envExampleExists) {
        await fs.writeFile(".env.example", envContent, "utf-8");
        await fs.writeFile(".env", envContent, "utf-8");
        spinner.succeed(
          `Success! Harvested ${envTracker.size} variables. Created both .env and .env.example.`
        );
      } else if (!envExists && envExampleExists) {
        await fs.writeFile(".env", envContent, "utf-8");
        spinner.succeed(
          `Success! Harvested ${envTracker.size} variables. Created fresh .env file.`
        );
      }

      process.exit(0);
    } catch (error) {
      spinner.fail("An unexpected system error occurred during processing.");
      console.error(error);
      process.exit(1);
    }
  });

program.parse();