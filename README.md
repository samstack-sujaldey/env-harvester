# Env Harvester

Automatically discover environment variables used across your codebase and generate professional `.env` and `.env.example` files with contextual placeholders and developer guidance.

## Overview

Env Harvester is an AI-powered CLI tool that scans JavaScript and TypeScript projects, detects environment variable usage, and generates ready-to-use environment configuration files.

Instead of manually creating `.env` files, Env Harvester analyzes your codebase, identifies required variables, and uses Gemini AI to provide:

- Realistic placeholder values
- Provider-specific setup instructions
- Usage location tracking
- Automatic `.env` and `.env.example` generation

---

## Features

- Automatic environment variable discovery
- Supports JavaScript, TypeScript, React, Next.js, and Node.js projects
- Generates both `.env` and `.env.example`
- Tracks where each variable is used
- AI-generated setup instructions
- Safe file creation logic
- Zero configuration setup
- Smart handling of existing environment files

---

## Installation

### Global Installation

```bash
npm install -g env-harvester
```

### Using NPX

```bash
npx env-harvester
```

---

## Requirements

- Node.js 18 or later
- Gemini API Key

You can generate a Gemini API key from Google AI Studio.

---

## Setting Up GEMINI_API_KEY

### Windows (Command Prompt)

Temporary (current terminal session only):

```cmd
set GEMINI_API_KEY=your_api_key_here
```

Permanent:

```cmd
setx GEMINI_API_KEY "your_api_key_here"
```

Verify:

```cmd
echo %GEMINI_API_KEY%
```

---

### Windows (PowerShell)

Temporary:

```powershell
$env:GEMINI_API_KEY="your_api_key_here"
```

Permanent:

```powershell
[Environment]::SetEnvironmentVariable(
    "GEMINI_API_KEY",
    "your_api_key_here",
    "User"
)
```

Verify:

```powershell
$env:GEMINI_API_KEY
```

---

### macOS (zsh)

Temporary:

```bash
export GEMINI_API_KEY="your_api_key_here"
```

Permanent:

```bash
echo 'export GEMINI_API_KEY="your_api_key_here"' >> ~/.zshrc
source ~/.zshrc
```

Verify:

```bash
echo $GEMINI_API_KEY
```

---

### Linux (bash)

Temporary:

```bash
export GEMINI_API_KEY="your_api_key_here"
```

Permanent:

```bash
echo 'export GEMINI_API_KEY="your_api_key_here"' >> ~/.bashrc
source ~/.bashrc
```

Verify:

```bash
echo $GEMINI_API_KEY
```

---

### Using a .env File

You may also create a `.env` file:

```env
GEMINI_API_KEY=your_api_key_here
```

---

## Usage

Navigate to your project directory and run:

```bash
env-harvester
```

The CLI will:

1. Crawl your project files
2. Detect environment variables
3. Track usage locations
4. Consult Gemini AI for contextual placeholders
5. Generate configuration files
6. Add setup instructions for each variable

---

## Example Output

Generated `.env` file:

```env
# Used in: src/config/database.js
# How to get: Create a MongoDB Atlas cluster and copy the connection string.
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/db

# Used in: src/server.js
# How to get: Standard local development port.
PORT=3000

# Used in: src/services/stripe.js
# How to get: Stripe Dashboard → Developers → API Keys.
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxx
```

---

## Smart File Handling

### Scenario 1

Existing files:

```text
.env
.env.example
```

Result:

```text
No changes made.
```

---

### Scenario 2

Existing files:

```text
.env
```

Result:

```text
Creates only .env.example
```

---

### Scenario 3

Existing files:

```text
None
```

Result:

```text
Creates both .env and .env.example
```

---

### Scenario 4

Existing files:

```text
.env.example
```

Result:

```text
Creates only .env
```

---

## Supported File Types

```text
.js
.jsx
.ts
.tsx
```

---

## Ignored Directories

```text
node_modules
.git
dist
build
generated
.next
coverage
```

---

## Example Workflow

```bash
cd my-project

env-harvester
```

Output:

```text
✔ Crawling project directory...
✔ Scanning files and tracking usage locations...
✔ Consulting AI to infer context and safe fallbacks...
✔ Writing configuration files...
✔ Success! Harvested 12 variables. Created both .env and .env.example.
```

---

## Security Notice

Env Harvester never generates real secrets or production credentials.

All generated values are placeholders intended to help developers configure their projects quickly and safely. Actual credentials should always be obtained directly from the corresponding service provider.

---

## Current Detection Support

Currently detects:

```js
process.env.MY_VARIABLE;
```

---

## Planned Improvements

- Support for `import.meta.env`
- Support for destructured environment variables

```js
const { API_KEY } = process.env;
```

- Support for bracket notation

```js
process.env["API_KEY"];
process.env["API_KEY"];
```

- Monorepo support
- Interactive mode
- CI/CD integration
- VS Code extension
- Secret validation

---

## Contributing

Contributions, suggestions, and bug reports are welcome.

Please open an issue before submitting major changes.

---

## Author

**Sujal Dey**

---

## License

Copyright (c) 2026 Sujal Dey

All Rights Reserved.

Permission is granted to use this software.

You may not:

- Modify the software
- Create derivative works
- Redistribute the software
- Publish modified versions
- Sell, sublicense, or repackage the software
- Remove copyright notices

This software is provided "as is" without warranty of any kind.
