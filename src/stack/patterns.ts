import { DetectionPattern } from './types.js';

/**
 * Padrões de detecção para diferentes tecnologias
 */
export const DETECTION_PATTERNS: Record<string, DetectionPattern> = {
  // === NODE.JS / JAVASCRIPT ===
  nodejs: {
    files: ['package.json'],
    weight: 100
  },
  
  typescript: {
    files: ['tsconfig.json', 'tsconfig.*.json'],
    dependencies: ['typescript', '@types/node'],
    weight: 90
  },
  
  react: {
    dependencies: ['react', 'react-dom', '@types/react'],
    scripts: ['react-scripts'],
    weight: 85
  },
  
  nextjs: {
    files: ['next.config.js', 'next.config.ts'],
    dependencies: ['next'],
    weight: 90
  },
  
  vue: {
    dependencies: ['vue', '@vue/cli'],
    files: ['vue.config.js'],
    weight: 85
  },
  
  angular: {
    files: ['angular.json'],
    dependencies: ['@angular/core', '@angular/cli'],
    weight: 90
  },
  
  svelte: {
    dependencies: ['svelte', '@sveltejs/kit'],
    files: ['svelte.config.js'],
    weight: 85
  },
  
  express: {
    dependencies: ['express', '@types/express'],
    weight: 70
  },
  
  nestjs: {
    dependencies: ['@nestjs/core', '@nestjs/common'],
    weight: 80
  },
  
  // === PACKAGE MANAGERS ===
  npm: {
    files: ['package-lock.json'],
    weight: 60
  },
  
  yarn: {
    files: ['yarn.lock'],
    weight: 60
  },
  
  pnpm: {
    files: ['pnpm-lock.yaml'],
    weight: 60
  },

  go_modules: {
    files: ['go.mod', 'go.sum'],
    weight: 80
  },

  // === PYTHON ===
  python: {
    files: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
    weight: 100
  },
  
  django: {
    files: ['manage.py', 'settings.py'],
    dependencies: ['django'],
    weight: 90
  },
  
  flask: {
    dependencies: ['flask'],
    weight: 80
  },
  
  fastapi: {
    dependencies: ['fastapi'],
    weight: 80
  },

  pyramid: {
    dependencies: ['pyramid'],
    files: ['development.ini', 'production.ini'],
    weight: 80
  },

  tornado: {
    dependencies: ['tornado'],
    weight: 75
  },

  // === PHP ===
  php: {
    files: ['composer.json'],
    weight: 100
  },
  
  laravel: {
    files: ['artisan', 'config/app.php'],
    dependencies: ['laravel/framework'],
    weight: 90
  },
  
  symfony: {
    dependencies: ['symfony/framework-bundle'],
    files: ['symfony.lock'],
    weight: 90
  },

  codeigniter: {
    files: ['application/config/config.php', 'system/core/CodeIgniter.php'],
    weight: 85
  },

  cakephp: {
    files: ['config/app.php', 'config/bootstrap.php'],
    dependencies: ['cakephp/cakephp'],
    weight: 85
  },

  // === JAVA ===
  java: {
    files: ['pom.xml', 'build.gradle', 'gradle.build'],
    weight: 100
  },
  
  maven: {
    files: ['pom.xml'],
    weight: 90
  },
  
  gradle: {
    files: ['build.gradle', 'gradle.build', 'gradlew'],
    weight: 90
  },
  
  spring: {
    files: ['application.properties', 'application.yml'],
    dependencies: ['spring-boot-starter'],
    weight: 85
  },

  spring_mvc: {
    dependencies: ['spring-webmvc', 'spring-web'],
    files: ['src/main/webapp/WEB-INF/web.xml'],
    weight: 80
  },

  hibernate: {
    dependencies: ['hibernate-core', 'hibernate-entitymanager'],
    files: ['hibernate.cfg.xml', 'persistence.xml'],
    weight: 75
  },

  quarkus: {
    dependencies: ['quarkus-core', 'io.quarkus'],
    files: ['src/main/resources/application.properties'],
    weight: 85
  },

  micronaut: {
    dependencies: ['micronaut-core'],
    files: ['src/main/resources/application.yml'],
    weight: 85
  },

  // === C# / .NET ===
  dotnet: {
    files: ['*.csproj', '*.sln', 'global.json'],
    weight: 100
  },
  
  aspnet: {
    files: ['Program.cs', 'Startup.cs'],
    weight: 80
  },

  blazor: {
    files: ['App.razor', '_Imports.razor', 'wwwroot/index.html'],
    dependencies: ['Microsoft.AspNetCore.Components'],
    weight: 85
  },

  entity_framework: {
    dependencies: ['Microsoft.EntityFrameworkCore', 'EntityFramework'],
    files: ['Migrations/*.cs'],
    weight: 80
  },

  // === RUST ===
  rust: {
    files: ['Cargo.toml', 'Cargo.lock'],
    weight: 100
  },

  actix: {
    dependencies: ['actix-web'],
    weight: 80
  },

  rocket: {
    dependencies: ['rocket'],
    weight: 80
  },

  warp: {
    dependencies: ['warp'],
    weight: 75
  },

  axum: {
    dependencies: ['axum'],
    weight: 80
  },

  // === GO ===
  golang: {
    files: ['go.mod', 'go.sum'],
    weight: 100
  },

  gin: {
    dependencies: ['github.com/gin-gonic/gin'],
    weight: 80
  },

  echo: {
    dependencies: ['github.com/labstack/echo'],
    weight: 80
  },

  fiber: {
    dependencies: ['github.com/gofiber/fiber'],
    weight: 80
  },

  beego: {
    dependencies: ['github.com/beego/beego'],
    weight: 75
  },

  // === BUILD TOOLS ===
  webpack: {
    files: ['webpack.config.js', 'webpack.*.js'],
    dependencies: ['webpack'],
    weight: 70
  },
  
  vite: {
    files: ['vite.config.js', 'vite.config.ts'],
    dependencies: ['vite'],
    weight: 75
  },
  
  rollup: {
    files: ['rollup.config.js'],
    dependencies: ['rollup'],
    weight: 70
  },

  // === BUILD TOOLS ADICIONAIS ===
  cargo: {
    files: ['Cargo.toml'],
    weight: 80
  },

  dotnet_build: {
    files: ['*.csproj', '*.sln'],
    weight: 80
  },

  bazel: {
    files: ['WORKSPACE', 'BUILD', 'BUILD.bazel'],
    weight: 75
  },

  // === MONOREPO TOOLS ===
  lerna: {
    files: ['lerna.json'],
    dependencies: ['lerna'],
    weight: 70
  },

  nx: {
    files: ['nx.json', 'workspace.json'],
    dependencies: ['@nrwl/workspace'],
    weight: 75
  },

  // === TEST FRAMEWORKS ===
  jest: {
    files: ['jest.config.js'],
    dependencies: ['jest', '@types/jest'],
    weight: 60
  },
  
  vitest: {
    dependencies: ['vitest'],
    weight: 60
  },
  
  cypress: {
    files: ['cypress.config.js'],
    dependencies: ['cypress'],
    weight: 65
  },
  
  // === LINTERS / FORMATTERS ===
  eslint: {
    files: ['.eslintrc.js', '.eslintrc.json', 'eslint.config.js'],
    dependencies: ['eslint'],
    weight: 50
  },
  
  prettier: {
    files: ['.prettierrc', '.prettierrc.json', 'prettier.config.js'],
    dependencies: ['prettier'],
    weight: 50
  },
  
  // === RUBY ===
  ruby: {
    files: ['Gemfile', 'Gemfile.lock', '*.gemspec'],
    weight: 100
  },
  
  rails: {
    files: ['config/application.rb', 'config/routes.rb'],
    dependencies: ['rails'],
    weight: 90
  },
  
  sinatra: {
    dependencies: ['sinatra'],
    weight: 80
  },

  hanami: {
    dependencies: ['hanami'],
    files: ['config/environment.rb', 'apps/web/application.rb'],
    weight: 80
  },

  bundler: {
    files: ['Gemfile.lock'],
    weight: 60
  },  // === DOCKER ===
  docker: {
    files: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'],
    weight: 60
  },
  
  // === CI/CD ===
  github_actions: {
    files: ['.github/workflows/*.yml', '.github/workflows/*.yaml'],
    weight: 40
  }
};

/**
 * Mapeamento de linguagens baseado em extensões de arquivo
 * Conforme COMPLETE_DEVELOPMENT_GUIDE.md - 9 linguagens principais
 */
export const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  // === PRINCIPAIS (9 linguagens do guia) ===
  javascript: ['.js', '.mjs', '.cjs'],
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  python: ['.py', '.pyx', '.pyi', '.pyw'],
  php: ['.php', '.phtml', '.php3', '.php4', '.php5'],
  java: ['.java'],
  csharp: ['.cs', '.csx'],
  rust: ['.rs'],
  go: ['.go'],
  ruby: ['.rb', '.rake', '.gemspec'],
  
  // === ADICIONAIS ===
  cpp: ['.cpp', '.cxx', '.cc', '.c++', '.hpp'],
  c: ['.c', '.h'],
  swift: ['.swift'],
  kotlin: ['.kt', '.kts'],
  scala: ['.scala'],
  clojure: ['.clj', '.cljs', '.cljc'],
  haskell: ['.hs', '.lhs'],
  elm: ['.elm'],
  dart: ['.dart'],
  
  // === WEB & CONFIG ===
  html: ['.html', '.htm'],
  css: ['.css', '.scss', '.sass', '.less'],
  vue: ['.vue'],
  svelte: ['.svelte'],
  json: ['.json'],
  yaml: ['.yml', '.yaml'],
  xml: ['.xml'],
  markdown: ['.md', '.mdx'],
  
  // === SCRIPTS & OUTROS ===
  shell: ['.sh', '.bash', '.zsh', '.fish'],
  sql: ['.sql'],
  dockerfile: ['Dockerfile', '.dockerfile'],
  makefile: ['Makefile', '.mk']
};