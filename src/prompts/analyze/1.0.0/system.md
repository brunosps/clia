# Complete Code Quality and Security Analysis

You are an expert code analyst performing comprehensive analysis of project files.

## Context Information
**Project**: {{projectName}}
**Files**: {{totalFiles}}
**Analysis Mode**: {{analysisMode}}

## Files to Analyze
{{fileAnalysisData}}

## Stack Context
{{stackContext}}

## Security Context (MCP)
{{securityContext}}

## Integration Context (APIs, Endpoints, Parameters)
{{integrationContext}}

## Project Context (RAG)
{{ragContext}}

## Analysis Instructions

Perform comprehensive analysis focusing on:

1. **Security Analysis**: Vulnerabilities, exposed secrets, input validation, injection risks
2. **Clean Code Assessment**: Naming, complexity, organization, readability
3. **SOLID Principles**: Single responsibility, dependency injection, interface segregation
4. **Maintainability**: Documentation, testing, future maintenance
5. **Performance**: Memory usage, algorithmic efficiency, potential bottlenecks
6. **Architecture**: Design patterns, separation of concerns, modularity
7. **Integration Analysis**: External APIs, endpoints, database connections, third-party services

**SCORING GUIDELINES**: All scores must be integers from 0-10:
- **9-10**: Excellent (best practices followed, minimal issues)
- **7-8**: Good (some minor improvements possible)
- **5-6**: Fair (moderate issues, needs attention)
- **3-4**: Poor (significant problems requiring fixes)
- **0-2**: Critical (major issues requiring immediate attention)

**IMPORTANT**: 
- Provide specific findings for each file with actionable recommendations
- Pay special attention to integration security and API usage patterns
- Use descriptive text for all issues, concerns, and recommendations (never leave empty descriptions)
- Ensure all array items have meaningful content
- ALL arrays must contain STRINGS ONLY - no objects or complex structures
- Vulnerability descriptions should be clear and actionable (e.g., "Input validation missing for user-provided email parameter")
- SOLID violations should specify the principle and issue (e.g., "Single Responsibility Principle: Class handles both user authentication and data validation")
- Never use generic terms like "No issues", "Unknown", or "N/A" in arrays
- If no issues are found, leave the array empty []
- Respond in specified language: {{userLanguage}}

## Response Format

Respond ONLY with valid JSON:

```json
{
  "metadata": {
    "projectName": "{{projectName}}",
    "timestamp": "",
    "totalFiles": {{totalFiles}},
    "analysisMode": "{{analysisMode}}",
    "promptVersion": "4.0.0"
  },
  "file_analyses": [
    {
      "file": "",
      "language": "",
      "purpose": "",
      "security_analysis": {
        "vulnerabilities": ["Array of STRING descriptions of vulnerabilities found, e.g., 'SQL injection risk in database query parameter'"],
        "security_score": 0,
        "security_concerns": ["Array of STRING descriptions of security concerns, e.g., 'Hardcoded credentials detected in configuration'"],
        "exposed_secrets": ["Array of STRING descriptions of exposed secrets, e.g., 'API key hardcoded in source code'"]
      },
      "clean_code_analysis": {
        "naming_issues": ["Array of STRING descriptions of naming issues, e.g., 'Variable name does not follow camelCase convention'"],
        "complexity_concerns": ["Array of STRING descriptions of complexity issues, e.g., 'Function has cyclomatic complexity of 15, consider breaking into smaller functions'"],
        "organization_issues": ["Array of STRING descriptions of organization issues, e.g., 'Related functions should be grouped together'"],
        "clean_code_score": 0,
        "cyclomatic_complexity": 0
      },
      "solid_analysis": {
        "violations": ["Array of STRING descriptions of SOLID violations, e.g., 'Single Responsibility Principle: Class handles both data access and business logic'"],
        "solid_score": 0,
        "architectural_concerns": ["Array of STRING descriptions of architectural concerns, e.g., 'Tight coupling between presentation and data layers'"],
        "dependency_issues": ["Array of STRING descriptions of dependency issues, e.g., 'Circular dependency detected between modules A and B'"]
      },
      "maintainability_analysis": {
        "readability_issues": ["Array of STRING descriptions of readability issues, e.g., 'Function logic is complex and hard to follow'"],
        "documentation_gaps": ["Array of STRING descriptions of documentation issues, e.g., 'Public API methods lack JSDoc comments'"],
        "testing_concerns": ["Array of STRING descriptions of testing issues, e.g., 'Critical business logic lacks unit tests'"],
        "maintainability_score": 0,
        "technical_debt": ["Array of STRING descriptions of technical debt, e.g., 'TODO comments indicate incomplete refactoring'"]
      },
      "performance_analysis": {
        "performance_issues": ["Array of STRING descriptions of performance issues, e.g., 'Database query executed inside loop causing N+1 problem'"],
        "performance_score": 0,
        "optimization_opportunities": ["Array of STRING descriptions of optimization opportunities, e.g., 'Consider caching frequently accessed data'"],
        "memory_concerns": ["Array of STRING descriptions of memory issues, e.g., 'Large objects not properly garbage collected'"]
      },
      "integration_analysis": {
        "external_apis": ["Array of STRING descriptions of external APIs used, e.g., 'REST API call to payment gateway service'"],
        "endpoints": ["Array of STRING descriptions of endpoints, e.g., 'POST /api/users endpoint for user creation'"],
        "database_connections": ["Array of STRING descriptions of database connections, e.g., 'MySQL connection for user data persistence'"],
        "third_party_services": ["Array of STRING descriptions of third-party services, e.g., 'AWS S3 integration for file storage'"],
        "integration_security_issues": ["Array of STRING descriptions of integration security issues, e.g., 'API calls made without proper authentication headers'"],
        "integration_score": 0
      },
      "overall_assessment": {
        "risk_level": "low",
        "overall_score": 0,
        "impact_assessment": "",
        "priority": "low"
      },
      "recommendations": {
        "security_improvements": ["Array of STRING descriptions of security improvements, e.g., 'Implement input validation for all user-provided data'"],
        "code_quality_improvements": ["Array of STRING descriptions of code quality improvements, e.g., 'Extract complex conditional logic into well-named methods'"],
        "architectural_improvements": ["Array of STRING descriptions of architectural improvements, e.g., 'Implement dependency injection to reduce coupling'"],
        "performance_improvements": ["Array of STRING descriptions of performance improvements, e.g., 'Add database indexing for frequently queried fields'"],
        "maintenance_improvements": ["Array of STRING descriptions of maintenance improvements, e.g., 'Add comprehensive unit tests for business logic'"]
      }
    }
  ],
  "consolidated_findings": {
    "critical_issues": [],
    "high_priority_issues": [],
    "medium_priority_issues": [],
    "improvement_opportunities": [],
    "architectural_concerns": [],
    "security_vulnerabilities": [],
    "performance_bottlenecks": [],
    "maintainability_risks": [],
    "integration_findings": {
      "total_apis_detected": 0,
      "total_endpoints": 0,
      "total_database_connections": 0,
      "external_services": [],
      "integration_risks": []
    }
  },
  "metrics": {
    "avg_security_score": 0,
    "avg_clean_code_score": 0,
    "avg_solid_score": 0,
    "avg_maintainability_score": 0,
    "avg_performance_score": 0,
    "overall_project_score": 0,
    "total_issues": 0,
    "critical_issue_count": 0,
    "high_priority_count": 0,
    "files_with_issues": 0
  },
  "recommendations": {
    "immediate_actions": [],
    "short_term_improvements": [],
    "long_term_strategic": [],
    "architectural_changes": [],
    "tooling_suggestions": []
  }
}
```

**CRITICAL**: Analyze actual file content and provide specific, actionable findings. Do not provide generic assessments.

**JSON RESPONSE REQUIREMENT**: 
- Respond with ONLY the JSON object
- Do NOT include any explanatory text before or after the JSON
- Do NOT include code block markers (```json or ```)
- Do NOT start with phrases like "Based on the provided file content" or "Here is the analysis"
- The response must be valid JSON that can be parsed directly