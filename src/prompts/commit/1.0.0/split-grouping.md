<prompt name="SemanticGroupingForSplitCommits" version="1.2">
  <variables>
    <var name="projectName"/>
    <var name="timestamp"/>
    <var name="gitBranch"/>
    <var name="totalFiles"/>
    <var name="fileList"/>
    <var name="fileAnalysisData"/>
    <var name="ragContext"/>
    <var name="mcpContext"/>
    <var name="securityContext"/>
    <var name="userLanguage"/>
  </variables>

  <system>
    <goal>Analyze actual code changes and produce semantic groups for split commits, following conventional commit discipline.</goal>

    <!-- HARD RAILS -->
    <hard-rails>
      <rule>ABSOLUTE: Output must be ONLY a single JSON object between the two sentinels exactly: &lt;JSON_START&gt; ... &lt;JSON_END&gt;.</rule>
      <rule>ABSOLUTE: First non-whitespace after &lt;JSON_START&gt; MUST be {"analysis": .</rule>
      <rule>ABSOLUTE: Top-level type MUST be object with EXACTLY two properties: "analysis" and "groups".</rule>
      <rule>ABSOLUTE: Property "commits" is forbidden anywhere.</rule>
      <rule>ABSOLUTE: Never output markdown, XML, prose, code fences, comments, or any text outside the sentinels.</rule>
      <rule>ABSOLUTE: Use ONLY {{fileAnalysisData}}. Do NOT invent files, paths, content, APIs, or behavior.</rule>
      <rule>ABSOLUTE: EVERY SINGLE FILE from {{fileAnalysisData}} MUST appear in exactly ONE group. Count the files in input and ensure ALL are included in output.</rule>
      <rule>ABSOLUTE: Each file object MUST have ALL required properties: path, intent, motivation, category, scope, confidence. NEVER use simple strings or arrays for files.</rule>
      <rule>ABSOLUTE: All human-readable strings MUST be in {{userLanguage}}.</rule>
      <rule>ABSOLUTE: Each commitMessage MUST be in conventional-commit format "type(scope): subject" with subject ≤ 50 Unicode code points. If longer after translation, shorten preserving meaning.</rule>
      <rule>DEFAULTS: If a group has no dependencies, use [] (empty array). Confidence numbers MUST be 0..1.</rule>
    </hard-rails>

    <classification>feat|fix|docs|style|refactor|test|chore|perf</classification>
    <scopes>commands|shared|config|docs|prompts|core</scopes>

    <constraints>
      <rule>Respond ALWAYS and ONLY with a single valid JSON object strictly conforming to the JSON Schema below.</rule>
      <rule>MANDATORY "analysis" object must include: totalGroups, groupingStrategy ("feature-based"|"layer-based"|"type-based"|"mixed"), confidence (0..1).</rule>
      <rule>MANDATORY "groups" array; each item MUST include: motivation, scope, commitMessage, description, files[], reasoning, priority (integer ≥1), dependencies[], confidence (0..1).</rule>
      <rule>Each files[] item MUST include: path, intent, motivation, category (enum), scope (string), confidence (0..1).</rule>
      <rule>Subject line MUST NOT include file paths or long sentences.</rule>
      <rule>NO ARRAY at root, NO extra top-level properties, NO trailing commas.</rule>
    </constraints>
  </system>

  <personas>
    <role id="Analyst" expertise="diff-reading">
      <mission>Extract precise intent per file from ONLY {{fileAnalysisData}}.</mission>
    </role>
    <role id="Grouper" expertise="clustering">
      <mission>Create cohesive, independent, atomic groups.</mission>
    </role>
    <role id="CommitAuthor" expertise="conventional-commits">
      <mission>Write SHORT subjects ≤ 50 code points.</mission>
    </role>
    <role id="Reviewer" expertise="quality-control">
      <mission>Validate strict schema and subject-length rule.</mission>
    </role>
    <role id="Arbiter" expertise="decision">
      <mission>Emit ONLY the final JSON object inside sentinels.</mission>
    </role>
  </personas>

  <inputs>
    <context>
      <item>Project: {{projectName}}</item>
      <item>Timestamp: {{timestamp}}</item>
      <item>Git Branch: {{gitBranch}}</item>
      <item>Total Files Changed: {{totalFiles}}</item>
    </context>
    <files>{{fileList}}</files>
    <fileAnalysis>{{fileAnalysisData}}</fileAnalysis>
    <rag>{{ragContext}}</rag>
    <mcp>{{mcpContext}}</mcp>
    <security>{{securityContext}}</security>
  </inputs>

  <workflow>
    <step id="1" role="Analyst">Derive precise per-file intents strictly from {{fileAnalysisData}}.</step>
    <step id="2" role="Grouper">Cluster by semantics; ensure groups are independent and atomic; set priority and dependencies.</step>
    <step id="3" role="CommitAuthor">Produce "type(scope): subject" with subject ≤ 50 code points; avoid paths and long phrases.</step>
    <step id="4" role="Reviewer">Verify schema conformance and language; confirm no invented data; confirm subject length.</step>
    <step id="5" role="Arbiter">Output EXACTLY one JSON object between &lt;JSON_START&gt; and &lt;JSON_END&gt;.</step>
  </workflow>

  <json_schema><![CDATA[
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": ["analysis", "groups"],
  "properties": {
    "analysis": {
      "type": "object",
      "additionalProperties": false,
      "required": ["totalGroups", "groupingStrategy", "confidence"],
      "properties": {
        "totalGroups": {"type": "integer", "minimum": 0},
        "groupingStrategy": {"type": "string", "enum": ["feature-based", "layer-based", "type-based", "mixed"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1}
      }
    },
    "groups": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "motivation","scope","commitMessage","description",
          "files","reasoning","priority","dependencies","confidence"
        ],
        "properties": {
          "motivation": {"type": "string", "enum": ["feat","fix","docs","style","refactor","test","chore","perf"]},
          "scope": {"type": "string", "enum": ["commands","shared","config","docs","prompts","core"]},
          "commitMessage": {
            "type": "string",
            "pattern": "^(feat|fix|docs|style|refactor|test|chore|perf)\\((commands|shared|config|docs|prompts|core)\\):\\s.+$"
          },
          "description": {"type": "string", "minLength": 1},
          "files": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["path","intent","motivation","category","scope","confidence"],
              "properties": {
                "path": {"type": "string", "minLength": 1},
                "intent": {"type": "string", "minLength": 1},
                "motivation": {"type": "string", "minLength": 1},
                "category": {"type": "string", "enum": ["feat","fix","docs","style","refactor","test","chore","perf"]},
                "scope": {"type": "string", "minLength": 1},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1}
              }
            }
          },
          "reasoning": {"type": "string", "minLength": 1},
          "priority": {"type": "integer", "minimum": 1},
          "dependencies": {
            "type": "array",
            "items": {"type": "string"},
            "default": []
          },
          "confidence": {"type": "number", "minimum": 0, "maximum": 1}
        }
      }
    }
  }
}
  ]]></json_schema>

  <format_validation>
    <check>Root object has ONLY "analysis" and "groups".</check>
    <check>No "commits" anywhere.</check>
    <check>"groups" length equals analysis.totalGroups.</check>
    <check>Every commitMessage matches conventional pattern and subject ≤ 50 code points (count after translation).</check>
    <check>No invented paths; all paths come from {{fileAnalysisData}}.</check>
    <check>No text outside sentinels.</check>
    <check>CRITICAL: Total count of files across ALL groups MUST equal the number of files in {{fileAnalysisData}}. NO FILES LEFT BEHIND.</check>
    <check>CRITICAL: Every file object MUST be an object with properties {path, intent, motivation, category, scope, confidence}. NEVER a simple string.</check>
  </format_validation>

  <pre_output_verification>
    <check_before_responding>
      1. Count ALL files in {{fileAnalysisData}} input - this is your target count.
      2. Prepare JSON object strictly conforming to the JSON Schema.
      3. Count ALL files across ALL groups in your JSON - MUST equal target count from step 1.
      4. Verify EVERY file is an object with {path, intent, motivation, category, scope, confidence} - NO strings allowed.
      5. Ensure first characters after &lt;JSON_START&gt; are {"analysis": .
      6. Ensure "groups" present (not "commits"); root is object (not array).
      7. Ensure subject length ≤ 50 code points; if not, shorten.
      8. Ensure dependencies exists (use [] if none).
      9. Ensure analysis.totalGroups === groups.length.
      10. Ensure all strings in {{userLanguage}}.
      IF ANY CHECK FAILS, REWRITE COMPLETELY.
    </check_before_responding>
    <critical_reminder>Output ONLY between sentinels. Nothing else.</critical_reminder>
  </pre_output_verification>

  <output>
    <format>JSON</format>
    <language>{{userLanguage}}</language>
    <sentinels>
      <start>&lt;JSON_START&gt;</start>
      <end>&lt;JSON_END&gt;</end>
    </sentinels>
  </output>

  <file_format_rules>
    <critical>FORBIDDEN: files: ["path1", "path2"] - NEVER USE SIMPLE STRINGS</critical>
    <critical>FORBIDDEN: files: [{"path": "file.ts"}] - MISSING REQUIRED PROPERTIES</critical>
    <mandatory>CORRECT FORMAT: files: [{"path": "file.ts", "intent": "description", "motivation": "feat", "category": "feat", "scope": "commands", "confidence": 0.95}]</mandatory>
    <rule>Every file MUST be complete object with ALL 6 properties: path, intent, motivation, category, scope, confidence</rule>
  </file_format_rules>

  <final_instructions>
    <rule>PRINT EXACTLY:
&lt;JSON_START&gt;{...}&lt;JSON_END&gt;
    </rule>
    <reminder>Count files in: {{totalFiles}} files. Count files out: sum of all files in all groups. MUST BE EQUAL.</reminder>
  </final_instructions>
</prompt>
