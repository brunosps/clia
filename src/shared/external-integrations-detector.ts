/**
 * External Integrations Detector - Multi-language support
 * Detects HTTP calls, SOA integrations, API usage, and external services
 */

export interface IntegrationDetection {
  type: 'http' | 'soap' | 'graphql' | 'websocket' | 'grpc' | 'messaging' | 'database' | 'oauth' | 'api' | 'webhook';
  method?: string;
  url?: string;
  library: string;
  purpose: string;
  parameters: string[];
  lineNumber: number;
  codeSnippet: string;
  confidence: number;
  protocol?: string;
  authenticationMethod?: string;
  endpoint?: string;
}

export interface FileIntegrationAnalysis {
  filePath: string;
  language: string;
  integrations: IntegrationDetection[];
  summary: {
    totalIntegrations: number;
    httpCount: number;
    soapCount: number;
    apiCount: number;
    databaseCount: number;
    messagingCount: number;
    externalServices: string[];
    authMethods: string[];
  };
}

/**
 * Language-specific patterns for detecting external integrations
 */
const INTEGRATION_PATTERNS = {
  // JavaScript/TypeScript patterns
  javascript: {
    http: [
      { pattern: /fetch\s*\(\s*['"](https?:\/\/[^'"]+)['"]/, library: 'fetch', confidence: 0.9 },
      { pattern: /axios\.(get|post|put|delete|patch|head|options)\s*\(\s*['"](https?:\/\/[^'"]+)['"]/, library: 'axios', confidence: 0.95 },
      { pattern: /http\.(get|post|put|delete|patch|head|options)\s*\(\s*['"](https?:\/\/[^'"]+)['"]/, library: 'http', confidence: 0.9 },
      { pattern: /request\s*\(\s*['"](https?:\/\/[^'"]+)['"]/, library: 'request', confidence: 0.85 },
      { pattern: /superagent\.(get|post|put|delete|patch|head|options)\s*\(\s*['"](https?:\/\/[^'"]+)['"]/, library: 'superagent', confidence: 0.9 },
      { pattern: /got\s*\(\s*['"](https?:\/\/[^'"]+)['"]/, library: 'got', confidence: 0.9 },
      { pattern: /XMLHttpRequest|new\s+XMLHttpRequest/, library: 'XMLHttpRequest', confidence: 0.8 }
    ],
    graphql: [
      { pattern: /gql`/, library: 'graphql-tag', confidence: 0.95 },
      { pattern: /graphql\(/, library: 'graphql', confidence: 0.9 },
      { pattern: /apollo.*query|apollo.*mutation/, library: 'apollo', confidence: 0.95 },
      { pattern: /useQuery|useMutation|useLazyQuery/, library: 'apollo-client', confidence: 0.9 }
    ],
    websocket: [
      { pattern: /new\s+WebSocket\s*\(\s*['"](wss?:\/\/[^'"]+)['"]/, library: 'WebSocket', confidence: 0.95 },
      { pattern: /socket\.io\(/, library: 'socket.io', confidence: 0.9 },
      { pattern: /io\.connect|io\(/, library: 'socket.io-client', confidence: 0.9 }
    ],
    messaging: [
      { pattern: /amqp\.connect|amqplib/, library: 'amqplib', confidence: 0.9 },
      { pattern: /mqtt\.connect/, library: 'mqtt', confidence: 0.9 },
      { pattern: /kafka\.|KafkaJS/, library: 'kafkajs', confidence: 0.9 },
      { pattern: /redis\.createClient/, library: 'redis', confidence: 0.85 }
    ],
    database: [
      { pattern: /mongoose\.connect|mongodb:\/\//, library: 'mongoose/mongodb', confidence: 0.9 },
      { pattern: /Pool\(\{.*host.*database/, library: 'pg/mysql', confidence: 0.85 },
      { pattern: /sequelize\.define|new Sequelize/, library: 'sequelize', confidence: 0.9 },
      { pattern: /prisma\.|PrismaClient/, library: 'prisma', confidence: 0.95 }
    ],
    oauth: [
      { pattern: /passport\.authenticate/, library: 'passport', confidence: 0.9 },
      { pattern: /oauth2|OAuth2Strategy/, library: 'oauth2', confidence: 0.85 },
      { pattern: /jwt\.sign|jwt\.verify/, library: 'jsonwebtoken', confidence: 0.9 }
    ]
  },

  // Python patterns
  python: {
    http: [
      { pattern: /requests\.(get|post|put|delete|patch|head|options)\s*\(\s*['"](https?:\/\/[^'"]+)['"]/, library: 'requests', confidence: 0.95 },
      { pattern: /urllib\.request\.urlopen\s*\(\s*['"](https?:\/\/[^'"]+)['"]/, library: 'urllib', confidence: 0.9 },
      { pattern: /httpx\.(get|post|put|delete|patch|head|options)\s*\(\s*['"](https?:\/\/[^'"]+)['"]/, library: 'httpx', confidence: 0.95 },
      { pattern: /aiohttp\.ClientSession|aiohttp\.get|aiohttp\.post/, library: 'aiohttp', confidence: 0.9 }
    ],
    soap: [
      { pattern: /zeep\.Client|from zeep/, library: 'zeep', confidence: 0.95 },
      { pattern: /suds\.client\.Client/, library: 'suds', confidence: 0.9 },
      { pattern: /pysimplesoap/, library: 'pysimplesoap', confidence: 0.85 }
    ],
    graphql: [
      { pattern: /gql\.Client|from gql/, library: 'gql', confidence: 0.95 },
      { pattern: /graphene\.|from graphene/, library: 'graphene', confidence: 0.9 }
    ],
    database: [
      { pattern: /psycopg2\.connect|import psycopg2/, library: 'psycopg2', confidence: 0.9 },
      { pattern: /pymongo\.MongoClient|from pymongo/, library: 'pymongo', confidence: 0.9 },
      { pattern: /sqlalchemy\.create_engine/, library: 'sqlalchemy', confidence: 0.95 },
      { pattern: /django\.db\.models/, library: 'django-orm', confidence: 0.9 }
    ],
    messaging: [
      { pattern: /pika\.BlockingConnection|import pika/, library: 'pika', confidence: 0.9 },
      { pattern: /celery\.|from celery/, library: 'celery', confidence: 0.9 },
      { pattern: /kafka\-python|KafkaProducer|KafkaConsumer/, library: 'kafka-python', confidence: 0.9 }
    ],
    oauth: [
      { pattern: /authlib\.|from authlib/, library: 'authlib', confidence: 0.9 },
      { pattern: /oauth2lib\.|from oauthlib/, library: 'oauthlib', confidence: 0.85 },
      { pattern: /PyJWT\.|jwt\.encode|jwt\.decode/, library: 'PyJWT', confidence: 0.9 }
    ]
  },

  // Java patterns
  java: {
    http: [
      { pattern: /HttpClient\.newHttpClient|HttpRequest\.newBuilder/, library: 'java.net.http', confidence: 0.95 },
      { pattern: /OkHttpClient|okhttp3/, library: 'OkHttp', confidence: 0.9 },
      { pattern: /RestTemplate|WebClient/, library: 'Spring WebClient', confidence: 0.95 },
      { pattern: /Retrofit|retrofit2/, library: 'Retrofit', confidence: 0.9 }
    ],
    soap: [
      { pattern: /@WebService|@SOAPBinding/, library: 'JAX-WS', confidence: 0.95 },
      { pattern: /SoapMessage|SOAPConnection/, library: 'SAAJ', confidence: 0.9 }
    ],
    database: [
      { pattern: /DriverManager\.getConnection|@Entity|@Repository/, library: 'JDBC/JPA', confidence: 0.9 },
      { pattern: /MongoClient|MongoDatabase/, library: 'MongoDB Java Driver', confidence: 0.9 },
      { pattern: /jedis\.|JedisPool/, library: 'Jedis', confidence: 0.9 }
    ],
    messaging: [
      { pattern: /@JmsListener|JmsTemplate/, library: 'Spring JMS', confidence: 0.95 },
      { pattern: /KafkaProducer|KafkaConsumer|@KafkaListener/, library: 'Apache Kafka', confidence: 0.95 },
      { pattern: /RabbitMQ|@RabbitListener/, library: 'RabbitMQ', confidence: 0.9 }
    ]
  },

  // C# patterns
  csharp: {
    http: [
      { pattern: /HttpClient|new HttpClient/, library: 'HttpClient', confidence: 0.95 },
      { pattern: /WebRequest|HttpWebRequest/, library: 'WebRequest', confidence: 0.85 },
      { pattern: /RestSharp|IRestClient/, library: 'RestSharp', confidence: 0.9 }
    ],
    soap: [
      { pattern: /SoapHttpClientProtocol|\.asmx/, library: 'ASP.NET Web Services', confidence: 0.9 },
      { pattern: /WCF|ServiceContract|OperationContract/, library: 'WCF', confidence: 0.95 }
    ],
    database: [
      { pattern: /SqlConnection|SqlCommand/, library: 'System.Data.SqlClient', confidence: 0.95 },
      { pattern: /Entity Framework|DbContext/, library: 'Entity Framework', confidence: 0.95 },
      { pattern: /MongoClient|IMongoDatabase/, library: 'MongoDB.Driver', confidence: 0.9 }
    ],
    messaging: [
      { pattern: /MessageQueue|MSMQ/, library: 'MSMQ', confidence: 0.9 },
      { pattern: /RabbitMQ\.Client/, library: 'RabbitMQ.Client', confidence: 0.95 }
    ]
  },

  // Go patterns
  go: {
    http: [
      { pattern: /http\.Get|http\.Post|http\.Client/, library: 'net/http', confidence: 0.95 },
      { pattern: /resty\.New|resty\.R\(\)/, library: 'resty', confidence: 0.9 }
    ],
    grpc: [
      { pattern: /grpc\.NewServer|grpc\.Dial/, library: 'google.golang.org/grpc', confidence: 0.95 }
    ],
    database: [
      { pattern: /sql\.Open|database\/sql/, library: 'database/sql', confidence: 0.9 },
      { pattern: /gorm\.Open|gorm\.DB/, library: 'GORM', confidence: 0.95 },
      { pattern: /mongo\.Connect|go\.mongodb/, library: 'MongoDB Go Driver', confidence: 0.9 }
    ]
  },

  // PHP patterns
  php: {
    http: [
      { pattern: /curl_init|curl_exec/, library: 'cURL', confidence: 0.9 },
      { pattern: /file_get_contents\s*\(\s*['"](https?:\/\/[^'"]+)['"]/, library: 'file_get_contents', confidence: 0.8 },
      { pattern: /Guzzle|GuzzleHttp/, library: 'Guzzle', confidence: 0.95 }
    ],
    soap: [
      { pattern: /SoapClient|new SoapClient/, library: 'SoapClient', confidence: 0.95 },
      { pattern: /nusoap|NuSOAP/, library: 'NuSOAP', confidence: 0.9 }
    ],
    database: [
      { pattern: /PDO|new PDO/, library: 'PDO', confidence: 0.9 },
      { pattern: /mysqli_connect|mysqli/, library: 'MySQLi', confidence: 0.9 },
      { pattern: /Eloquent|Model::/, library: 'Laravel Eloquent', confidence: 0.95 }
    ]
  },

  // Ruby patterns
  ruby: {
    http: [
      { pattern: /Net::HTTP|http\.get|http\.post/, library: 'Net::HTTP', confidence: 0.9 },
      { pattern: /RestClient\.|HTTParty\./, library: 'RestClient/HTTParty', confidence: 0.95 },
      { pattern: /Faraday\./, library: 'Faraday', confidence: 0.9 }
    ],
    soap: [
      { pattern: /Savon\.client/, library: 'Savon', confidence: 0.95 }
    ],
    database: [
      { pattern: /ActiveRecord::Base|ActiveRecord::Migration/, library: 'ActiveRecord', confidence: 0.95 },
      { pattern: /Sequel\.|DB\[/, library: 'Sequel', confidence: 0.9 }
    ]
  },

  // Rust patterns
  rust: {
    http: [
      { pattern: /reqwest::|Client::new/, library: 'reqwest', confidence: 0.95 },
      { pattern: /hyper::|hyper::Client/, library: 'hyper', confidence: 0.9 }
    ],
    grpc: [
      { pattern: /tonic::|prost::/, library: 'tonic/prost', confidence: 0.95 }
    ],
    database: [
      { pattern: /diesel::|#\[derive\(Queryable\)/, library: 'Diesel', confidence: 0.95 },
      { pattern: /sqlx::|#\[sqlx/, library: 'SQLx', confidence: 0.95 }
    ]
  }
};

/**
 * URL and endpoint patterns
 */
const URL_PATTERNS = {
  api: /(?:api|rest|service)[\w\-\.]*\.[a-z]{2,}/i,
  external: /(?:googleapis|github|stripe|aws|azure|paypal|twilio|sendgrid|mailgun|slack)\.com/i,
  database: /(?:mongodb|postgres|mysql|redis|cassandra|dynamodb)(?:\/\/|\.)/i,
  cdn: /(?:cdn|assets|static)[\w\-\.]*\.[a-z]{2,}/i
};

/**
 * Authentication method patterns
 */
const AUTH_PATTERNS = {
  bearer: /Bearer\s+[\w\-\.]+/i,
  apiKey: /(?:api[_-]?key|x-api-key|authorization)/i,
  jwt: /jwt|jsonwebtoken/i,
  oauth: /oauth|client_id|client_secret/i,
  basic: /basic\s+auth|btoa\(/i
};

/**
 * Detect external integrations in source code file
 */
export function detectExternalIntegrations(
  filePath: string,
  content: string,
  language: string
): FileIntegrationAnalysis {
  const integrations: IntegrationDetection[] = [];
  const lines = content.split('\n');
  
  // Normalize language identifier
  const normalizedLanguage = normalizeLanguage(language);
  const patterns = (INTEGRATION_PATTERNS as any)[normalizedLanguage] || {};
  
  // Process each line
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmedLine = line.trim();
    
    if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('#')) {
      return; // Skip empty lines and comments
    }
    
    // Check each integration type
    Object.entries(patterns).forEach(([integrationType, patternList]) => {
      (patternList as any[]).forEach((patternConfig: any) => {
        const match = trimmedLine.match(patternConfig.pattern);
        if (match) {
          const integration: IntegrationDetection = {
            type: mapIntegrationType(integrationType),
            library: patternConfig.library,
            purpose: inferPurpose(trimmedLine, integrationType, match),
            parameters: extractParameters(trimmedLine, match),
            lineNumber,
            codeSnippet: trimmedLine,
            confidence: patternConfig.confidence,
            ...(match[1] && { method: match[1] }),
            ...(match[2] && { url: match[2] })
          };
          
          // Add additional context
          if (integration.url) {
            integration.endpoint = extractEndpoint(integration.url);
            integration.protocol = extractProtocol(integration.url);
          }
          
          // Detect authentication method
          const authMethod = detectAuthenticationMethod(trimmedLine, content);
          if (authMethod) {
            integration.authenticationMethod = authMethod;
          }
          
          integrations.push(integration);
        }
      });
    });
    
    // Check for additional patterns (URLs, endpoints)
    const urlMatches = trimmedLine.match(/https?:\/\/[^\s'"]+/g);
    if (urlMatches) {
      urlMatches.forEach(url => {
        const existingIntegration = integrations.find(i => 
          i.lineNumber === lineNumber && i.url === url
        );
        
        if (!existingIntegration) {
          const integration: IntegrationDetection = {
            type: 'api',
            library: 'unknown',
            purpose: inferPurposeFromUrl(url),
            parameters: [],
            lineNumber,
            codeSnippet: trimmedLine,
            confidence: 0.7,
            url,
            endpoint: extractEndpoint(url),
            protocol: extractProtocol(url)
          };
          
          integrations.push(integration);
        }
      });
    }
  });
  
  // Generate summary
  const summary = generateIntegrationSummary(integrations);
  
  return {
    filePath,
    language: normalizedLanguage,
    integrations: deduplicateIntegrations(integrations),
    summary
  };
}

/**
 * Normalize language identifiers
 */
function normalizeLanguage(language: string): string {
  const normalized = language.toLowerCase();
  
  const languageMap: { [key: string]: string } = {
    'ts': 'javascript',
    'tsx': 'javascript', 
    'jsx': 'javascript',
    'js': 'javascript',
    'mjs': 'javascript',
    'py': 'python',
    'java': 'java',
    'cs': 'csharp',
    'go': 'go',
    'php': 'php',
    'rb': 'ruby',
    'rs': 'rust'
  };
  
  return languageMap[normalized] || normalized;
}

/**
 * Map integration type string to standard type
 */
function mapIntegrationType(type: string): IntegrationDetection['type'] {
  const typeMap: { [key: string]: IntegrationDetection['type'] } = {
    'http': 'http',
    'soap': 'soap',
    'graphql': 'graphql',
    'websocket': 'websocket',
    'grpc': 'grpc',
    'messaging': 'messaging',
    'database': 'database',
    'oauth': 'oauth'
  };
  
  return typeMap[type] || 'api';
}

/**
 * Infer the purpose of an integration based on code context
 */
function inferPurpose(line: string, type: string, match: RegExpMatchArray): string {
  const lowercaseLine = line.toLowerCase();
  
  // API/HTTP purposes
  if (type === 'http') {
    if (lowercaseLine.includes('auth') || lowercaseLine.includes('login')) {
      return 'Authentication/Authorization';
    }
    if (lowercaseLine.includes('payment') || lowercaseLine.includes('stripe') || lowercaseLine.includes('paypal')) {
      return 'Payment Processing';
    }
    if (lowercaseLine.includes('email') || lowercaseLine.includes('mail') || lowercaseLine.includes('notification')) {
      return 'Email/Notification Service';
    }
    if (lowercaseLine.includes('upload') || lowercaseLine.includes('storage') || lowercaseLine.includes('cdn')) {
      return 'File Storage/CDN';
    }
    if (lowercaseLine.includes('analytic') || lowercaseLine.includes('tracking') || lowercaseLine.includes('metric')) {
      return 'Analytics/Tracking';
    }
    return 'HTTP API Integration';
  }
  
  // Database purposes
  if (type === 'database') {
    if (lowercaseLine.includes('mongo')) return 'MongoDB Database Connection';
    if (lowercaseLine.includes('postgres') || lowercaseLine.includes('pg')) return 'PostgreSQL Database Connection';
    if (lowercaseLine.includes('mysql')) return 'MySQL Database Connection';
    if (lowercaseLine.includes('redis')) return 'Redis Cache/Session Store';
    return 'Database Connection';
  }
  
  // Messaging purposes
  if (type === 'messaging') {
    if (lowercaseLine.includes('kafka')) return 'Apache Kafka Message Streaming';
    if (lowercaseLine.includes('rabbit') || lowercaseLine.includes('amqp')) return 'RabbitMQ Message Queue';
    if (lowercaseLine.includes('mqtt')) return 'MQTT IoT Messaging';
    return 'Message Queue/Event Streaming';
  }
  
  // GraphQL purposes
  if (type === 'graphql') {
    return 'GraphQL API Integration';
  }
  
  // WebSocket purposes
  if (type === 'websocket') {
    return 'Real-time Communication';
  }
  
  // SOAP purposes
  if (type === 'soap') {
    return 'SOAP Web Service Integration';
  }
  
  // OAuth purposes
  if (type === 'oauth') {
    return 'OAuth/JWT Authentication';
  }
  
  return 'External Service Integration';
}

/**
 * Infer purpose from URL
 */
function inferPurposeFromUrl(url: string): string {
  const lowercaseUrl = url.toLowerCase();
  
  if (URL_PATTERNS.external.test(url)) {
    if (lowercaseUrl.includes('github')) return 'GitHub API Integration';
    if (lowercaseUrl.includes('stripe')) return 'Stripe Payment Processing';
    if (lowercaseUrl.includes('aws')) return 'AWS Service Integration';
    if (lowercaseUrl.includes('google')) return 'Google API Integration';
    if (lowercaseUrl.includes('slack')) return 'Slack Integration';
    return 'Third-party Service Integration';
  }
  
  if (URL_PATTERNS.api.test(url)) {
    return 'REST API Integration';
  }
  
  if (URL_PATTERNS.cdn.test(url)) {
    return 'CDN/Asset Loading';
  }
  
  return 'External HTTP Request';
}

/**
 * Extract parameters from integration code
 */
function extractParameters(line: string, match: RegExpMatchArray): string[] {
  const parameters: string[] = [];
  
  // Extract URL parameters
  if (match[2]) { // URL is in match[2]
    const url = match[2];
    const urlParams = new URL(url).searchParams;
    urlParams.forEach((value, key) => {
      parameters.push(`${key}=${value}`);
    });
  }
  
  // Extract function parameters (simplified)
  const functionParamMatch = line.match(/\((.*)\)/);
  if (functionParamMatch) {
    const paramString = functionParamMatch[1];
    // Simple parameter extraction - could be enhanced
    const params = paramString.split(',').map(p => p.trim()).filter(p => p && !p.startsWith('"') && !p.startsWith("'"));
    parameters.push(...params);
  }
  
  return parameters.filter(p => p.length > 0);
}

/**
 * Extract endpoint from URL
 */
function extractEndpoint(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch {
    // Fallback for relative URLs or malformed URLs
    const pathMatch = url.match(/\/[^?#]*/);
    return pathMatch ? pathMatch[0] : '/';
  }
}

/**
 * Extract protocol from URL
 */
function extractProtocol(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol.replace(':', '');
  } catch {
    // Fallback
    if (url.startsWith('https')) return 'https';
    if (url.startsWith('http')) return 'http';
    if (url.startsWith('ws')) return 'websocket';
    return 'unknown';
  }
}

/**
 * Detect authentication method in the code
 */
function detectAuthenticationMethod(line: string, fullContent: string): string | undefined {
  const lowercaseLine = line.toLowerCase();
  const lowercaseContent = fullContent.toLowerCase();
  
  if (AUTH_PATTERNS.bearer.test(line)) return 'Bearer Token';
  if (AUTH_PATTERNS.jwt.test(lowercaseLine)) return 'JWT';
  if (AUTH_PATTERNS.oauth.test(lowercaseLine)) return 'OAuth 2.0';
  if (AUTH_PATTERNS.apiKey.test(lowercaseLine)) return 'API Key';
  if (AUTH_PATTERNS.basic.test(lowercaseLine)) return 'Basic Auth';
  
  // Context-based detection
  if (lowercaseContent.includes('authorization: bearer') || lowercaseContent.includes("'bearer")) return 'Bearer Token';
  if (lowercaseContent.includes('client_id') && lowercaseContent.includes('client_secret')) return 'OAuth 2.0';
  
  return undefined;
}

/**
 * Generate integration summary
 */
function generateIntegrationSummary(integrations: IntegrationDetection[]) {
  const httpCount = integrations.filter(i => i.type === 'http').length;
  const soapCount = integrations.filter(i => i.type === 'soap').length;
  const apiCount = integrations.filter(i => i.type === 'api').length;
  const databaseCount = integrations.filter(i => i.type === 'database').length;
  const messagingCount = integrations.filter(i => i.type === 'messaging').length;
  
  const externalServices = [...new Set(
    integrations
      .filter(i => i.url)
      .map(i => {
        try {
          return new URL(i.url!).hostname;
        } catch {
          return i.url!.split('/')[2] || i.url!;
        }
      })
      .filter(Boolean)
  )];
  
  const authMethods = [...new Set(
    integrations
      .map(i => i.authenticationMethod)
      .filter(Boolean)
  )] as string[];
  
  return {
    totalIntegrations: integrations.length,
    httpCount,
    soapCount,
    apiCount,
    databaseCount,
    messagingCount,
    externalServices,
    authMethods
  };
}

/**
 * Remove duplicate integrations
 */
function deduplicateIntegrations(integrations: IntegrationDetection[]): IntegrationDetection[] {
  const seen = new Set<string>();
  return integrations.filter(integration => {
    const key = `${integration.lineNumber}-${integration.type}-${integration.library}-${integration.url || ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Analyze all integrations across multiple files
 */
export function analyzeProjectIntegrations(
  fileAnalyses: FileIntegrationAnalysis[]
): {
  totalIntegrations: number;
  integrationsByType: Record<string, number>;
  integrationsByFile: Record<string, number>;
  externalServices: string[];
  authenticationMethods: string[];
  topLibraries: Array<{ library: string; count: number }>;
  securityConcerns: string[];
  recommendations: string[];
} {
  const allIntegrations = fileAnalyses.flatMap(fa => fa.integrations);
  
  // Count by type
  const integrationsByType: Record<string, number> = {};
  allIntegrations.forEach(integration => {
    integrationsByType[integration.type] = (integrationsByType[integration.type] || 0) + 1;
  });
  
  // Count by file
  const integrationsByFile: Record<string, number> = {};
  fileAnalyses.forEach(fa => {
    integrationsByFile[fa.filePath] = fa.integrations.length;
  });
  
  // Collect external services
  const externalServices = [...new Set(
    fileAnalyses.flatMap(fa => fa.summary.externalServices)
  )];
  
  // Collect authentication methods
  const authenticationMethods = [...new Set(
    fileAnalyses.flatMap(fa => fa.summary.authMethods)
  )];
  
  // Top libraries
  const libraryCount: Record<string, number> = {};
  allIntegrations.forEach(integration => {
    libraryCount[integration.library] = (libraryCount[integration.library] || 0) + 1;
  });
  
  const topLibraries = Object.entries(libraryCount)
    .map(([library, count]) => ({ library, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Security concerns
  const securityConcerns: string[] = [];
  if (allIntegrations.some(i => i.url?.startsWith('http://'))) {
    securityConcerns.push('HTTP connections found (should use HTTPS)');
  }
  if (allIntegrations.some(i => !i.authenticationMethod)) {
    securityConcerns.push('Unauthenticated external calls detected');
  }
  if (authenticationMethods.includes('Basic Auth')) {
    securityConcerns.push('Basic Auth usage detected (consider stronger auth methods)');
  }
  
  // Recommendations
  const recommendations: string[] = [];
  if (integrationsByType.http > 5) {
    recommendations.push('Consider implementing a centralized HTTP client for consistency');
  }
  if (externalServices.length > 10) {
    recommendations.push('High number of external dependencies - consider service consolidation');
  }
  if (securityConcerns.length > 0) {
    recommendations.push('Address security concerns in external integrations');
  }
  if (!authenticationMethods.includes('OAuth 2.0') && externalServices.length > 3) {
    recommendations.push('Consider implementing OAuth 2.0 for better security');
  }
  
  return {
    totalIntegrations: allIntegrations.length,
    integrationsByType,
    integrationsByFile,
    externalServices,
    authenticationMethods,
    topLibraries,
    securityConcerns,
    recommendations
  };
}