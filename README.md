# Liste Chevron

Application desktop (Windows) pour enregistrer les travailleurs et visiteurs sur site.

## Télécharger sur le PC du travail

1. Ouvre : https://github.com/joey603/liste-chevron-worker/releases
2. Télécharge **`Liste-Chevron-Setup-….exe`**
3. Installe l’application

## Mises à jour automatiques

Après chaque `git push` sur `main`, GitHub construit une nouvelle version.

Sur le PC (avec Internet) :
1. Un message **עדכון זמין** apparaît
2. Clique **עדכן עכשיו**
3. Un chargement s’affiche pendant le téléchargement / l’installation
4. L’app se ferme et redémarre avec la nouvelle version

Le fichier de données local (`liste-data.json`) **n’est pas effacé**.

## Développement

```bash
npm install
npm run dev
```

```bash
git add .
git commit -m "description"
git push
```

→ nouvelle Release automatique quelques minutes plus tard.
