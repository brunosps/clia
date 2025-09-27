import requests
from bs4 import BeautifulSoup
import re
import json
import os
import sys
from datetime import datetime

# Processa argumentos
lockfile_path = "./package-lock.json"
output_json = False

for arg in sys.argv[1:]:
    if arg == "--json":
        output_json = True
    else:
        lockfile_path = arg

# URLs para scraping
urls = [
    "https://www.aikido.dev/blog/npm-debug-and-chalk-packages-compromised"
]

# Regex para pacotes colados com versão
pattern = re.compile(r'([a-z0-9_-]+)(\d+\.\d+\.\d+)', re.IGNORECASE)
iocs = []

# Scraping
fetched_online = False
for url in urls:
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        text = soup.get_text()
        matches = pattern.findall(text)
        for name, version in matches:
            iocs.append({"package": name, "version": version})
        fetched_online = True
    except Exception as e:
        print(f"Erro ao acessar {url}: {e}")

# Remove duplicatas
unique_iocs = {f"{ioc['package']}@{ioc['version']}": ioc for ioc in iocs}
iocs_list = list(unique_iocs.values())

# Carrega package-lock.json
if not os.path.isfile(lockfile_path):
    print(f"Arquivo '{lockfile_path}' não encontrado.")
    sys.exit(2)

with open(lockfile_path, "r") as f:
    lock_data = json.load(f)

# Verifica pacotes comprometidos
found = []

def extract_from_v1(deps):
    for name, info in deps.items():
        version = info.get("version")
        if version:
            for ioc in iocs_list:
                if ioc["package"] == name and ioc["version"] == version:
                    found.append(ioc)
        if "dependencies" in info:
            extract_from_v1(info["dependencies"])

def extract_from_v2(packages_dict):
    for path, info in packages_dict.items():
        if path.startswith("node_modules/"):
            name = path.split("/")[1]
            version = info.get("version")
            if version:
                for ioc in iocs_list:
                    if ioc["package"] == name and ioc["version"] == version:
                        found.append(ioc)

if "packages" in lock_data:
    extract_from_v2(lock_data["packages"])
elif "dependencies" in lock_data:
    extract_from_v1(lock_data["dependencies"])

status = "clean" if not found else "compromised"

# Saída
if output_json:
    output = {
        "scanned_lockfile": os.path.realpath(lockfile_path),
        "scanned_at_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": status,
        "fetched_from_internet": fetched_online,
        "findings": found,
        "iocs_source": iocs_list,
        "remediation": {
            "steps": [
                "Remova/downgrade versões comprometidas e reinstale (npm ci).",
                "Pine versões seguras e exija PRs revisados para upgrades.",
                "Revogue tokens/credenciais (npm/CI) e habilite 2FA/SSO.",
                "Recrie builds e limpe caches (CI/CD, CDN)."
            ]
        }
    }
    print(json.dumps(output, indent=2))
else:
    print(f"Arquivo: {os.path.realpath(lockfile_path)}")
    print(f"Coleta online de IOCs: {'OK' if fetched_online else 'FALLBACK'}")
    if status == "clean":
        print("✅ Nenhum match com IOCs.")
    else:
        print("🚨 Encontrado(s) pacote(s) comprometido(s):")
        for ioc in found:
            print(f"  - {ioc['package']}@{ioc['version']}")
        print(f"\n\nMitigação (resumo):\n  1) Fixe/downgrade para versões limpas; rode `npm ci` a partir de lockfile confiável.\n  2) Revogue tokens npm/CI; habilite 2FA/SSO.\n  3) Recrie builds e limpe caches (CI/CD, CDN).\n")

