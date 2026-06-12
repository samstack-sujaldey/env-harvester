#!/usr/bin/env node

import { program } from "commander";
import ora from "ora";
import fg from "fast-glob";
import fs from "fs/promises";
import { GoogleGenAI } from "@google/genai";

// Initialize the Gemini SDK securely using the environment variable
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

program
  .name("env-harvester")
  .description("Auto-generates .env and .env.example by scanning your codebase")
  .version("1.0.0")
  .action(async () => {
    const spinner = ora("Checking project environment...").start();

    try {
      // ---------------------------------------------------------
      // EARLY CHECK: Determine which files already exist
      // ---------------------------------------------------------
      let envExists = false;
      let envExampleExists = false;

      // Check for .env
      try {
        await fs.access(".env");
        envExists = true;
      } catch (e) {}

      // Check for .env.example
      try {
        await fs.access(".env.example");
        envExampleExists = true;
      } catch (e) {}

      // Rule 1: If both exist, do nothing and exit immediately
      if (envExists && envExampleExists) {
        spinner.succeed(
          "Both .env and .env.example are already present. No changes made.",
        );
        process.exit(0);
      }

      // ---------------------------------------------------------
      // STEP A: Crawl Files (Ignoring build & generated folders)
      // ---------------------------------------------------------
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

      // ---------------------------------------------------------
      // STEP B: Read, Extract, and Track Locations
      // ---------------------------------------------------------
      spinner.text = "Scanning files and tracking usage locations...";
      const envTracker = new Map();
      const regex = /process\.env\.([A-Z0-9_]+)/g;

      for (const file of files) {
        const content = await fs.readFile(file, "utf-8");
        let match;
        while ((match = regex.exec(content)) !== null) {
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

      // ---------------------------------------------------------
      // STEP C: Consult API for Contextual Fallbacks
      // ---------------------------------------------------------
      spinner.text = "Consulting AI to infer context and safe fallbacks...";
      const keysToAnalyze = Array.from(envTracker.keys()).join(", ");

      const prompt = `
        You are an expert developer onboarding assistant. I am giving you a list of environment variable keys found in a project codebase: [${keysToAnalyze}].
        
        For each key, provide two things:
        1. "value": A realistic, non-secret placeholder value or standard default fallback (e.g., 3000 for PORT, or a dummy string for keys containing KEY/SECRET/TOKEN).
        2. "instructions": A concise, 1-2 sentence instruction on exactly where the developer can find or generate this specific key online (e.g., "Go to the Stripe Dashboard > Developers > API Keys" or "Standard local configuration").
        
        Return ONLY a clean, valid JSON object. Do not wrap it in markdown code blocks. Example format:
        {
          "PORT": { "value": "3000", "instructions": "Standard default port for local development." },
          "STRIPE_API_KEY": { "value": "sk_test_123", "instructions": "Log into your Stripe Dashboard, navigate to Developers -> API Keys, and copy the Secret key." }
        }
      `;

      let aiFallbacks = {};
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
        });

        // Clean up text response if the model accidentally included markdown wrappers
        const cleanJsonText = response.text.replace(/```json|```/g, "").trim();
        aiFallbacks = JSON.parse(cleanJsonText);
      } catch (aiError) {
        // If the API call fails, we log a warning but keep going using generic fallbacks

        console.error("\n--- DEBUG ERROR ---");
        console.error(aiError);
        console.error("-------------------\n");
        spinner.warn(
          "AI API call failed or key is missing. Using generic fallbacks instead.",
        );
      }

      // ---------------------------------------------------------
      // STEP D: Build the File Content String
      // ---------------------------------------------------------
      let envContent =
        "# ------------------------------------------------------\n";
      envContent += "# Auto-generated environment variables by env-harvester\n";
      envContent +=
        "# ------------------------------------------------------\n\n";

      for (const [key, fileSet] of envTracker.entries()) {
        const aiResponse = aiFallbacks[key];

        // Setup base defaults
        let finalValue = "your_value_here";
        let instructions =
          "Check provider documentation to generate this value.";

        // Safely extract the new nested JSON structure
        if (aiResponse && typeof aiResponse === "object") {
          finalValue = aiResponse.value || finalValue;
          instructions = aiResponse.instructions || instructions;
        } else if (typeof aiResponse === "string") {
          // Fallback just in case the AI returns the old format
          finalValue = aiResponse;
        }

        const filesUsedIn = Array.from(fileSet);

        // Inject the file locations
        envContent += `# Used in: ${filesUsedIn.join(", ")}\n`;
        // Inject the AI-generated instructions
        envContent += `# How to get: ${instructions}\n`;
        // Print the actual variable
        envContent += `${key}=${finalValue}\n\n`;
      }

      // ---------------------------------------------------------
      // STEP E: Write Files Safely
      // ---------------------------------------------------------
      spinner.text = "Writing configuration files...";

      // Rule 2: If only .env is present, just create .env.example
      if (envExists && !envExampleExists) {
        await fs.writeFile(".env.example", envContent, "utf-8");
        spinner.succeed(
          `Success! Harvested ${envTracker.size} variables. Created .env.example (Your existing .env was kept safe).`,
        );
      }
      // Rule 3: If neither are present, create both with the exact same content
      else if (!envExists && !envExampleExists) {
        await fs.writeFile(".env.example", envContent, "utf-8");
        await fs.writeFile(".env", envContent, "utf-8");
        spinner.succeed(
          `Success! Harvested ${envTracker.size} variables. Created both .env and .env.example.`,
        );
      }
      // Edge case: If .env.example exists but .env does not
      else if (!envExists && envExampleExists) {
        await fs.writeFile(".env", envContent, "utf-8");
        spinner.succeed(
          `Success! Harvested ${envTracker.size} variables. Created fresh .env file.`,
        );
      }

      // Force the Node process to cleanly exit
      process.exit(0);
    } catch (error) {
      spinner.fail("An error occurred during harvesting.");
      console.error(error);
      process.exit(1);
    }
  });

program.parse();
