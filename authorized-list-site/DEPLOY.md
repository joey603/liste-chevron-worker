# Déploiement רשימת מורשים

Site publié avec Liste Chevron Pages :

**https://joey603.github.io/liste-chevron-worker/authorized/**

L’accès se fait avec le lien secret :

```text
https://joey603.github.io/liste-chevron-worker/authorized/#/s/VOTRE_ACCESS_SECRET
```

## Important : le fichier Excel local n’est PAS la prod

Le chemin du type  
`/Users/.../רשימת מורשים.xlsx`  
servait uniquement aux tests locaux.

En production, le site parle à une **Google Sheet** via **Apps Script**.

## Ce qu’il faut faire avec le VRAI fichier Drive

1. Sur Google Drive, ouvrir le **vrai** Excel `רשימת מורשים`
2. Clic droit → **Ouvrir avec → Google Sheets**  
   (ou Fichier → Enregistrer au format Google Sheets)
3. Vérifier les colonnes :
   - A `שם פרטי`
   - B `שם משפחה`
   - C `סוג`
   - D `הערות`
   - E `תאריך סיום` (optionnel, date `YYYY-MM-DD`)
4. Dans cette Sheet : **Extensions → Apps Script**
5. Coller le contenu de `apps-script/authorized-list-api.gs`
6. **Projet → Paramètres → Propriétés du script** :
   - `ACCESS_SECRET` = longue clé aléatoire  
     Exemple : `openssl rand -hex 24`
   - `SPREADSHEET_ID` = l’ID dans l’URL de la Sheet  
     `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
7. **Déployer → Nouveau déploiement → Application Web**
   - Exécuter en tant que : **Moi**
   - Qui peut y accéder : **Tout le monde**
8. Copier l’URL `…/exec`
9. Dans GitHub → Settings → Secrets → Actions, créer :
   - `AUTHORIZED_LIST_API_URL` = cette URL `…/exec`
10. Relancer le workflow **Publish web app** (ou pousser un commit)
11. Partager uniquement :

```text
https://joey603.github.io/liste-chevron-worker/authorized/#/s/ACCESS_SECRET
```

## Liste Chevron (app présence)

Dans les réglages, lier le **même** fichier Excel (Drive Desktop / chemin Windows du vrai fichier), pas le fichier d’exemple.
