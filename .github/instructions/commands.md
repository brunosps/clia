Diretrizes para comandos

Uso de LLM

Minimizar chamadas à LLM → ideal apenas 1 chamada por comando.

Se possível, evitar chamadas; caso necessário, usar prompt bem estruturado que resolva tudo de uma vez.

Logs

Remover todos os console.log.

Utilizar logger somente onde realmente for necessário.

Prompts

Manter prompts em src/prompts.

Implementar sistema de substituição de variáveis.

Preferir XML ou outro formato moderno para estruturar os prompts.

Retornos da LLM devem sempre vir em JSON.

Integração MCP

Utilizar os novos MCPs do projeto sempre que possível para executar comandos.


<prompt version="1.0">
  <meta>
    <command>{{commandName}}</command>
    <objective>Executar {{commandName}} com 1 chamada de LLM, retornando JSON válido.</objective>
  </meta>

  <directives>
    <llm>
      <minimizeCalls>true</minimizeCalls>
      <singleCall>true</singleCall>
      <note>Se não for possível evitar, use um prompt robusto que resolva tudo de uma vez.</note>
    </llm>

    <logging>
      <removeConsoleLog>true</removeConsoleLog>
      <useLogger>Somente onde realmente necessário.</useLogger>
    </logging>

    <prompts>
      <location>src/prompts/*.md</location>
      <format>Arquivo .md com conteúdo XML</format>
      <variables>Utilizar {{varName}} para substituição</variables>
    </prompts>

    <mcp>
      <useMCP>Aplicar MCPs sempre que possível para executar comandos e reduzir chamadas à LLM.</useMCP>
    </mcp>

    <output>
      <format>JSON</format>
      <constraint>Retorno sempre estruturado em JSON válido.</constraint>
    </output>
  </directives>

  <context>
    <repoRoot>{{repoRoot}}</repoRoot>
    <targetPaths>{{targetPaths}}</targetPaths>
    <mcp>
      <available>{{mcpList}}</available>
    </mcp>
  </context>

  <task>
    {{taskDescription}}
  </task>

  <inputs>
    <var name="codeSelection">{{codeSelection}}</var>
    <var name="projectGuidelines">{{guidelines}}</var>
    <var name="constraints">{{constraints}}</var>
  </inputs>

  <output>
    <schema>
      <![CDATA[
      {
        "type": "object",
        "required": ["summary", "actions"],
        "properties": {
          "summary": { "type": "string" },
          "actions": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["type", "path", "description"],
              "properties": {
                "type": { "type": "string", "enum": ["edit","create","delete","note"] },
                "path": { "type": "string" },
                "description": { "type": "string" },
                "diff": { "type": "string" }
              }
            }
          },
          "warnings": { "type": "array", "items": { "type": "string" } }
        }
      }
      ]]>
    </schema>
    <example>
      <![CDATA[
      {
        "summary": "Refatoração aplicada sem alterar API pública.",
        "actions": [
          { "type": "edit", "path": "src/module/x.ts", "description": "Troca console.log por logger", "diff": "..." }
        ],
        "warnings": []
      }
      ]]>
    </example>
  </output>

  <instructions>
    <step>Valide internamente o JSON antes de responder.</step>
    <step>Não inclua texto fora do JSON.</step>
  </instructions>
</prompt>
