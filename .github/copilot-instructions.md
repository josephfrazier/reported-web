# Reported-Web
Reported-Web is a React-based web application for reporting traffic violations in NYC. It's built on React Starter Kit with Node.js, Express, MongoDB/Parse Server backend, and includes image/video processing capabilities for license plate recognition.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively
- Bootstrap, build, and test the repository:
  - `cp .env.example .env`
  - `yarn config set ignore-engines true` -- Required for Node.js version compatibility
  - `yarn install --ignore-engines` -- takes 2 minutes. NEVER CANCEL. Set timeout to 5+ minutes.
  - `yarn lint` -- takes 5 seconds
  - `yarn build` -- development build takes 10 seconds. NEVER CANCEL. Set timeout to 2+ minutes.
  - `yarn build -- --release` -- production build takes 20 seconds. NEVER CANCEL. Set timeout to 3+ minutes.
- Test the application:
  - `yarn test` -- takes 23 seconds. NEVER CANCEL. Set timeout to 3+ minutes.
  - Note: Some tests may fail due to missing API keys (GEO_APP_ID, GEO_APP_KEY, GOOGLE_API_KEY, PLATERECOGNIZER_TOKEN)
- Run the web application:
  - Development: `yarn start` -- takes 7 seconds to compile, runs on http://localhost:3000. NEVER CANCEL. Set timeout to 2+ minutes for initial compilation.
  - Production: `node build/server.js` -- runs the pre-built production server
- Full application with Parse Server (requires MongoDB):
  - `yarn mongo-start` -- starts MongoDB (may fail in sandboxed environments)
  - `yarn parse` -- starts Parse Server on port 1337
  - `yarn dashboard` -- starts Parse Dashboard
  - `yarn mongo-stop` -- stops MongoDB

## Node.js Version Compatibility
- Application expects Node.js 20.18.1 but works with newer versions
- ALWAYS run `yarn config set ignore-engines true` before any yarn commands
- Use `--ignore-engines` flag for yarn install: `yarn install --ignore-engines`

## Build Timeouts and Performance
- **CRITICAL**: NEVER CANCEL builds or long-running commands
- Installation: 2 minutes (creates 974MB node_modules)
- Development build: 10 seconds
- Production build: 20 seconds  
- Test suite: 23 seconds
- Linting: 5 seconds
- Development server startup: 7 seconds
- Always set timeouts with 50% buffer: install=5min, build=3min, test=3min, start=2min

## Validation
- Always manually validate code changes by running the development server with `yarn start`
- Test key user scenarios: navigation, form submission, file upload
- The application handles traffic violation reporting with image/video upload and license plate recognition
- ALWAYS run `yarn lint` before committing changes or the CI (.github/workflows/lint.yml) will fail
- ALWAYS run `yarn build` to ensure no build errors before committing

## CI/CD Workflows
The following GitHub Actions workflows run on every push:
- **lint.yml**: Runs `yarn lint` (5 seconds)
- **test.yml**: Runs `yarn test` with API keys from secrets (23 seconds)  
- **build.yml**: Runs `yarn build` (10 seconds)
- All use Node.js 20.18.1 and yarn 1.22.19

## Environment Variables
Required API keys (set in .env):
- `GEO_APP_ID` and `GEO_APP_KEY` -- NYC Geoclient API for address validation
- `GOOGLE_API_KEY` -- Google Maps API for mapping features
- `PLATERECOGNIZER_TOKEN` -- License plate recognition service
- `PARSE_APP_ID`, `PARSE_JAVASCRIPT_KEY`, `PARSE_MASTER_KEY` -- Parse Server configuration
- `PARSE_SERVER_URL` -- Parse Server endpoint (default: http://localhost:1337/parse)

## Architecture Overview
- **Frontend**: React 16.5.2 with universal rendering (client + server)
- **Backend**: Express server with Parse Server for API and database
- **Database**: MongoDB with Parse SDK
- **Build**: Webpack with Babel for ES6+/JSX transpilation
- **Styling**: CSS modules with PostCSS, Marx CSS, Material-UI components
- **Testing**: Jest with React Test Renderer

## Key Dependencies and Workarounds
- `puppeteer` may fail to install Chromium in sandboxed environments (marked as optional)
- `bcrypt` may fail to compile but is marked as optional
- React version 16.5.2 has peer dependency warnings with newer Material-UI
- Uses custom forked packages: `@josephfrazier/react-dropzone`, `react-localstorage`

## Common Tasks
### Repository Structure
```
.
├── /build/                     # Compiled output (18MB after build)
├── /docs/                      # Project documentation  
├── /node_modules/              # Dependencies (974MB after install)
├── /public/                    # Static assets
├── /src/                       # Source code
│   ├── /components/            # React components
│   ├── /routes/                # Page components and routing
│   ├── /client.js              # Client-side entry point
│   ├── /server.js              # Server-side entry point
│   └── /config.js              # App configuration
├── /test/                      # Test files
├── /tools/                     # Build scripts and utilities
├── package.json                # Dependencies and scripts
├── yarn.lock                   # Locked dependency versions
├── .env.example                # Environment variables template
└── Dockerfile                  # Production container config
```

### Package.json Scripts Reference
- `yarn start` -- Development server with hot reload
- `yarn build` -- Development build
- `yarn build -- --release` -- Production build with minification
- `yarn test` -- Run Jest test suite
- `yarn test-watch` -- Run tests in watch mode
- `yarn lint` -- Run ESLint and Stylelint
- `yarn fix` -- Auto-fix linting issues
- `yarn mongo-start` -- Start MongoDB
- `yarn parse` -- Start Parse Server
- `yarn dashboard` -- Start Parse Dashboard
- `yarn mongo-stop` -- Stop MongoDB

### Heroku Deployment
- Uses `heroku-postbuild` script that runs `yarn build --release`
- Procfile: `web: node build/server.js`
- Requires Heroku buildpacks: `heroku/nodejs` and `jontewks/puppeteer`
- Set stack to `heroku-22` in app.json

## Performance Considerations
The app has known performance issues with localStorage usage that can cause typing lag in forms. The issue is related to:
- Automatic form state saving every 500ms
- Previous submissions data loading
- localStorage overhead with large datasets

Workaround implemented: Previous submissions are loaded only when expanded to avoid performance impact during form input.

## Known Issues
- Node.js version strict requirement (use --ignore-engines)
- Puppeteer Chromium download may fail in restricted environments
- Some tests require external API access and may timeout
- Material-UI peer dependency warnings with React 16.x
- Webpack deprecation warnings (expected with current setup)