#!/bin/bash

# CLIA MCP Configuration Checker
# Verifica se os servidores MCP necessários estão disponíveis

echo "🔍 CLIA MCP Configuration Checker"
echo "=================================="
echo ""

# Função para verificar comando
check_command() {
    local cmd=$1
    local name=$2
    
    if command -v "$cmd" &> /dev/null; then
        echo "✅ $name: Disponível"
        return 0
    else
        echo "❌ $name: NÃO disponível"
        return 1
    fi
}

# Função para verificar arquivo
check_file() {
    local file=$1
    local name=$2
    
    if [ -f "$file" ]; then
        echo "✅ $name: Encontrado"
        return 0
    else
        echo "❌ $name: NÃO encontrado"
        return 1
    fi
}

# Verificar dependências básicas
echo "📋 Verificando dependências básicas:"
check_command "node" "Node.js"
check_command "npm" "NPM"
check_command "git" "Git"
echo ""

# Verificar Semgrep
echo "🔒 Verificando Semgrep:"
if check_command "semgrep" "Semgrep"; then
    echo "   Versão: $(semgrep --version)"
else
    echo "   💡 Instale com: pip install semgrep"
fi
echo ""

# Verificar arquivos de configuração
echo "⚙️ Verificando configuração:"
check_file "clia.config.json" "Configuração do CLIA"
check_file "package.json" "Package.json"

if [ -f "clia.config.json" ]; then
    if grep -q "semgrep" clia.config.json; then
        echo "✅ Semgrep MCP: Configurado"
    else
        echo "❌ Semgrep MCP: NÃO configurado"
    fi
    
    if grep -q "stack-detector" clia.config.json; then
        echo "✅ Stack Detector MCP: Configurado"
    else
        echo "❌ Stack Detector MCP: NÃO configurado"
    fi
fi
echo ""

# Verificar MCPs externos (opcional)
echo "🌐 Verificando MCPs externos (opcionais):"
check_command "gh" "GitHub CLI"

if npm list -g @modelcontextprotocol/server-github &> /dev/null; then
    echo "✅ GitHub MCP Server: Instalado"
else
    echo "❌ GitHub MCP Server: NÃO instalado"
    echo "   💡 Instale com: npm install -g @modelcontextprotocol/server-github"
fi
echo ""

# Testar CLIA
echo "🧪 Testando CLIA:"
if [ -f "dist/index.js" ]; then
    echo "✅ CLIA: Compilado"
    echo "   💡 Execute: npm start -- --help"
elif [ -f "src/index.ts" ]; then
    echo "⚠️ CLIA: Código fonte disponível (requer compilação)"
    echo "   💡 Execute: npm run build"
else
    echo "❌ CLIA: NÃO encontrado"
fi
echo ""

# Resumo
echo "📊 Resumo da configuração:"
echo "========================="

# Verificar se Semgrep está funcionando
if command -v semgrep &> /dev/null; then
    echo "✅ Análise de segurança: Funcionará (Semgrep disponível)"
else
    echo "❌ Análise de segurança: NÃO funcionará (Semgrep ausente)"
fi

echo "✅ Detecção de stack: Funcionará (implementação local)"

if command -v gh &> /dev/null && npm list -g @modelcontextprotocol/server-github &> /dev/null; then
    echo "✅ Integração GitHub: Funcionará"
else
    echo "⚠️ Integração GitHub: Funcionalidade limitada"
fi

echo "⚠️ StackOverflow: Aguardando servidor MCP da comunidade"
echo "⚠️ Context7: Requer conectividade com serviço externo"
echo ""

echo "🚀 Para começar:"
echo "  1. npm run build"
echo "  2. npm start -- security-scan"
echo "  3. npm start -- stack"