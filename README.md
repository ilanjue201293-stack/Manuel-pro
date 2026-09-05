# Chat privé — Ilan, Naïm, Juul, Ruben

Projet prêt à importer dans GitHub puis à déployer sur Vercel.

## Ce que tu as à faire

### 1. GitHub

Dézippe le projet et mets **tout le contenu du dossier** dans un repository GitHub.

### 2. Vercel

Dans Vercel :

1. **Add New → Project**
2. importe le repository GitHub ;
3. laisse Vercel détecter **Next.js** ;
4. dans le projet Vercel, ajoute/relie **Supabase** depuis Storage / Marketplace.

La connexion Supabase de Vercel fournit automatiquement les variables de base de données et les clés nécessaires au site.

**Tu n'as aucun SQL à copier, aucune table à créer et aucune commande à exécuter.**

Au premier login réussi, le site crée automatiquement :

- les 4 profils : Ilan, Naïm, Juul et Ruben ;
- les 6 discussions privées ;
- les tables messages, groupes, réactions, vues, présence et paramètres ;
- les index nécessaires ;
- le stockage privé `private-media` pour les photos, vidéos, GIF et fichiers.

Si plusieurs fonctions démarrent en même temps, un verrou PostgreSQL empêche une double initialisation.

### 3. Les seules ENV à ajouter toi-même

Dans **Vercel → Project → Settings → Environment Variables** :

```text
ILAN_PASSWORD=...
NAIM_PASSWORD=...
JUUL_PASSWORD=...
RUBEN_PASSWORD=...
```

C'est tout pour le fonctionnement normal.

Tu peux aussi ajouter facultativement :

```text
CHAT_SESSION_SECRET=une-longue-valeur-aleatoire
```

Ce n'est pas obligatoire : si elle n'existe pas, le site utilise le secret serveur Supabase déjà fourni automatiquement par Vercel pour signer les sessions.

Après avoir changé l'un des mots de passe, fais un **Redeploy** sur Vercel. L'ancienne session de ce profil sera alors invalidée.

---

## Variables Supabase automatiques

Le code sait utiliser les variables actuelles de l'intégration Supabase/Vercel :

```text
POSTGRES_URL_NON_POOLING
POSTGRES_URL
SUPABASE_URL
SUPABASE_SECRET_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Il accepte aussi les anciens noms `SUPABASE_SERVICE_ROLE_KEY` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` si besoin.

Tu n'as normalement **pas à les copier manuellement** quand Supabase est relié au projet Vercel.

---

## Fonctionnalités

- 4 profils fixes, aucune inscription publique ;
- mot de passe différent pour chaque profil ;
- cookie de session sécurisé HTTP-only ;
- discussions privées ;
- groupes ;
- messages texte ;
- images, vidéos, audio, GIF et fichiers jusqu'à 100 Mo ;
- réponses ;
- réactions emoji ;
- modification et suppression de ses messages ;
- transfert d'un message vers une autre discussion ;
- accusés de lecture ;
- présence en ligne ;
- photo de profil personnalisable ;
- couleur d'accent ;
- taille du texte ;
- mode clair/sombre ;
- interface téléphone + ordinateur.

Les messages se rafraîchissent environ toutes les 2,5 secondes, ce qui est volontairement simple pour seulement 4 personnes.

---

## Sécurité

- aucun mot de passe n'est inclus dans le JavaScript envoyé au navigateur ;
- les mots de passe restent dans les ENV serveur de Vercel ;
- la clé secrète Supabase reste uniquement côté serveur ;
- les tables sont protégées par RLS et ne sont pas accessibles avec la clé navigateur ;
- les médias restent dans un bucket privé ;
- les téléchargements utilisent des URL temporaires signées ;
- les uploads passent directement du navigateur vers Supabase et non via une Function Vercel ;
- aucune inscription publique.

Le site est privé mais accessible sur Internet : utilisez des mots de passe qui ne servent pas pour vos comptes importants.

---

## Si le site dit que Supabase n'est pas connecté

Dans Vercel, vérifie simplement que le resource **Supabase** est bien relié au même projet et au bon environnement (Production).

Il n'y a toujours aucun SQL à exécuter manuellement.
