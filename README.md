# Liste Chevron

Application desktop (Windows) pour enregistrer les travailleurs et visiteurs sur site.

## Télécharger sur le PC du travail

1. Ouvre la page **Releases** du dépôt GitHub  
   (exemple : `https://github.com/TON-COMPTE/liste-chevron-worker/releases`)
2. Clique sur la **dernière version** (ex. `v1.0.0`)
3. Télécharge le fichier **`Liste-Chevron-Setup-….exe`**
4. Lance le fichier et installe l’application

Les données restent **locales** sur le PC (`liste-data.json` dans le dossier AppData de l’app).

## Publier une nouvelle version (après une modification)

Sur ton Mac / PC de développement :

```bash
# 1. Enregistre et pousse le code
git add .
git commit -m "description du changement"
git push

# 2. Monte la version dans package.json si besoin (ex: 1.0.1), puis :
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions construit automatiquement l’installateur Windows et l’ajoute à la page **Releases**.  
Ensuite, sur le PC du travail : même lien Releases → télécharger le nouveau `.exe`.

## Développement

```bash
npm install
npm run dev
```

## Données

Tout est stocké localement dans un fichier JSON sur le PC (aucun cloud).
