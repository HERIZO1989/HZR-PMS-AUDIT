#!/bin/bash
set -e
echo "== Initialisation du depot Git =="
git init
git add .
git commit -m "Initial commit - PMS Riviera"
git branch -M main

read -p "Colle ici l'URL de ton repo GitHub (ex: https://github.com/toncompte/pms-riviera.git): " REPO_URL
git remote add origin "$REPO_URL"
git push -u origin main

echo ""
echo "Termine ! Va maintenant sur https://app.netlify.com -> Add new site -> Import from GitHub"
