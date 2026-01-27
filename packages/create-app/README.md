# create-mercato-app

Create a new Open Mercato application with a single command.

## Quick Start

```bash
npx create-mercato-app my-app
cd my-app
```

## Usage

```bash
npx create-mercato-app <app-name> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `app-name` | Name of the application (creates folder with this name) |

### Options

| Option | Description |
|--------|-------------|
| `--registry <url>` | Custom npm registry URL |
| `--verdaccio` | Use local Verdaccio registry (http://localhost:4873) |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |

### Examples

```bash
# Create a new app using the public npm registry
npx create-mercato-app my-store

# Create a new app using a local Verdaccio registry
npx create-mercato-app my-store --verdaccio

# Create a new app using a custom registry
npx create-mercato-app my-store --registry http://localhost:4873
```

## After Creating Your App

1. Navigate to your app directory:
   ```bash
   cd my-app
   ```

2. Copy and configure your environment:
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. Install dependencies:
   ```bash
   yarn install
   ```

4. Generate required files:
   ```bash
   yarn generate
   ```

5. Run database migrations:
   ```bash
   yarn db:migrate
   ```

6. Initialize the application:
   ```bash
   yarn initialize
   ```

7. Start the development server:
   ```bash
   yarn dev
   ```

## Requirements

- Node.js 18 or later
- PostgreSQL database
- Yarn (recommended) or npm

## Learn More

For more information about Open Mercato, visit:
- [GitHub Repository](https://github.com/open-mercato/open-mercato)
- [Documentation](https://docs.openmercato.com)
