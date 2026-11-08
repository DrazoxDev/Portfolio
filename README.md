# Portfolio Camille SORET

Le portfolio est servi par Node.js afin que la page `/admin/` puisse être protégée et enregistrer les projets dans `data/projets.json`.

## Préparation locale

1. Installer Node.js 20.6 ou plus récent.
2. Créer le hash du mot de passe administrateur avec `npm run create-admin-hash` (dans PowerShell sous Windows : `npm.cmd run create-admin-hash`).
3. Créer un fichier `.env` à la racine et y placer les valeurs affichées par la commande, puis ajouter `NODE_ENV=development` et éventuellement `PORT=3000`.
4. Lancer le site avec `npm start` (dans PowerShell sous Windows : `npm.cmd start`), puis ouvrir `http://localhost:3000/admin/`.

Le mot de passe n'est jamais stocké en clair. Le fichier `.env` contient le hash et une clé de session ; il est ignoré par Git et n'est pas servi par le serveur web.

## Mise en ligne sur le serveur de l'IUT

L'hébergement doit autoriser Node.js 20.6+ et maintenir une application Node active, soit directement, soit derrière un proxy HTTPS. Il faut configurer `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `NODE_ENV=production` et `PORT` dans l'environnement du serveur (pas dans un fichier publié). En production, la connexion doit passer par HTTPS.

Si le serveur de l'IUT ne permet que le dépôt de fichiers statiques, l'interface d'administration sécurisée ne peut pas fonctionner dessus : il faudra demander un hébergement Node.js ou déployer cette application sur un service compatible.

## Référencement naturel

Les pages publiques ont des titres et descriptions dédiés, une seule accroche principale (`h1`), des données structurées Schema.org, des aperçus pour les réseaux sociaux et une URL propre par projet (`/projets/nom-du-projet/`). La page d'administration porte une directive `noindex`; `robots.txt` exclut les routes d'API tout en laissant les moteurs lire cette directive. Le serveur produit un sitemap à jour à partir des projets publiés.

Après avoir choisi et connecté le domaine public en HTTPS, ajouter `SITE_URL=https://ton-domaine.fr` à l'environnement de l'application et redémarrer Node. Sans cette valeur, les URL canoniques absolues sont volontairement omises et `/sitemap.xml` reste désactivé : cela évite de publier de fausses URL avant la mise en ligne. Vérifier ensuite `https://ton-domaine.fr/robots.txt` et `https://ton-domaine.fr/sitemap.xml`, puis déclarer le sitemap dans Google Search Console et Bing Webmaster Tools. Le référencement prend du temps et aucune position n'est garantie.

## Administration

Depuis `/admin/`, l'éditeur permet d'ajouter, modifier, supprimer et réordonner les projets. Chaque projet garde son URL même si son titre est renommé. Une modification conserve l'image existante si aucune nouvelle image n'est choisie, et conserve les liens du projet sous forme de champs modifiables. Les images JPEG/PNG/WebP sont limitées à 5 Mo et enregistrées dans `images/`.

Les autres onglets administrent le profil, les compétences, les qualités, le portrait chinois, les influences, les coordonnées et les palettes claire/sombre. Ces contenus sont enregistrés dans `data/site.json`; les projets restent dans `data/projets.json`. Les champs texte sont rendus comme texte et les liens comme URL HTTP(S) validées. Pour les images de qualités et d'influences, choisis un fichier déjà présent dans `images/` (les images ajoutées aux projets apparaissent aussi dans la liste).
