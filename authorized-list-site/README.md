# רשימת מורשים — site sécurisé (lien secret)

Site web séparé pour consulter et modifier la **רשימת מורשים**, avec le même format que l’Excel Liste Chevron :

| Colonne | Contenu |
|---------|---------|
| A | שם פרטי |
| B | שם משפחה |
| C | סוג (`קבוע` / `ויזיטור`) |
| D | הערות |
| E | תאריך סיום (YYYY-MM-DD, optionnel — autorisé jusqu’à la fin de ce jour) |

Liste Chevron (si elle tourne) retire automatiquement les noms expirés de l’Excel, puis du סרגל / רשימת נוכחים.

Accès : **lien secret seul** (`#/s/<ACCESS_SECRET>`). Sans ce secret, la page et l’API refusent l’accès.

## 1. Google Sheet + Apps Script

1. Créer une Google Sheet (ex. `רשימת מורשים`).
2. Ligne 1 (en-têtes) : `שם פרטי` | `שם משפחה` | `סוג` | `הערות`
3. Importer les lignes depuis l’Excel Drive existant (copier-coller ou Fichier → Importer).
4. **Extensions → Apps Script** → coller [`../apps-script/authorized-list-api.gs`](../apps-script/authorized-list-api.gs)
5. **Projet → Paramètres → Propriétés du script** → ajouter :
   - `ACCESS_SECRET` = longue clé aléatoire  
     Exemple : `openssl rand -hex 24`
6. **Déployer → Nouveau déploiement → Application Web**
   - Exécuter en tant que : **Moi**
   - Qui peut y accéder : **Tout le monde**
7. Copier l’URL `…/exec`

## 2. Frontend

```bash
cd authorized-list-site
cp .env.example .env
# Éditer .env : VITE_API_URL=<URL …/exec>
npm install
npm run dev      # http://localhost:5174
npm run build    # sortie dans dist/
```

## 3. Lien à partager

Après déploiement du frontend (GitHub Pages / Cloudflare Pages / autre) :

```text
https://VOTRE-SITE/#/s/VOTRE_ACCESS_SECRET
```

Exemple local :

```text
http://localhost:5174/#/s/VOTRE_ACCESS_SECRET
```

Donnez **uniquement** ce lien aux personnes autorisées. Quiconque possède le lien peut lire et modifier la liste.

## 4. Sécurité (limites)

- Le secret dans l’URL est le contrôle d’accès (comme un Google Doc « quiconque dispose du lien »).
- Ne publiez pas le lien publiquement ; régénérez `ACCESS_SECRET` s’il fuit (mettre à jour la propriété du script + le lien partagé).
- Le site met `noindex` pour limiter l’indexation moteurs.

## Lien avec Liste Chevron

Phase 1 : Liste Chevron continue d’utiliser son Excel local / Drive Desktop. Ce site lit/écrit la **Google Sheet**. Une synchronisation Sheet ↔ Excel pourra être ajoutée plus tard.
