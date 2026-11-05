# WMA MUSIC — mise en ligne sur Vercel

YOUR MUSIC. YOUR AFRICA. YOUR SOUND.
Application de streaming de WMA UNITED AFRICA, prête à déployer sur Vercel, avec Supabase pour les comptes, le catalogue et les fichiers audio.

## Contenu du projet

| Fichier / dossier | Rôle |
|---|---|
| `index.html` | L'application complète (lecteur, recherche, artistes, albums, playlists, comptes, WMA ADMIN) |
| `config.js` | Adresse et clé publique de votre projet Supabase (à remplir) |
| `artists/` | Photos officielles des artistes (BELMA : photo à ajouter) |
| `supabase/01-schema.sql` | Tables, sécurité et stockage des fichiers |
| `supabase/02-catalogue.sql` | Catalogue de départ : 11 artistes, biographies, photos, pistes de démonstration, playlists |
| `manifest.webmanifest`, `icon-*.png`, `icon.svg` | Installation de l'application sur téléphone (« Ajouter à l'écran d'accueil ») |
| `vercel.json` | Réglages Vercel (cache, sécurité) |

Il n'y a rien à compiler : Vercel publie les fichiers tels quels.

Sans configuration, l'application s'ouvre en **mode démonstration** : tout fonctionne, mais les données restent dans le navigateur de chaque visiteur. Une fois `config.js` rempli, elle utilise Supabase.

---

## Étape 1 — Préparer Supabase (10 minutes)

Utilisez le projet Supabase déjà créé pour wmaua.com.

1. Ouvrez **Supabase → SQL Editor → New query**.
2. Collez tout le contenu de `supabase/01-schema.sql`, puis cliquez sur **Run**.
3. Faites de même avec `supabase/02-catalogue.sql`.
4. Ouvrez **Project Settings → API** et notez :
   - **Project URL**, par exemple `https://abcd1234.supabase.co` ;
   - la clé **anon public**.

   La clé **service_role** ne doit jamais être copiée dans le projet.

Les tables de WMA MUSIC commencent toutes par `music_`. Elles ne modifient pas les tables du site (comptes artistes, soumissions, blog).

## Étape 2 — Renseigner `config.js`

Ouvrez `config.js` et collez vos deux valeurs :

```js
window.WMA_CONFIG = {
  supabaseUrl: "https://abcd1234.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

La clé anon est faite pour être publique : la sécurité repose sur les règles de la base créées à l'étape 1. Elle n'est donc pas une clé secrète.

## Étape 3 — Mettre le projet sur GitHub

Procédez comme pour wma-website.

1. Sur github.com, avec le compte **Landryxbb**, cliquez sur **New repository**.
2. Nommez-le `wma-music`, choisissez **Private**, puis cliquez sur **Create repository**.
3. Cliquez sur **uploading an existing file**.
4. Glissez **tout le contenu** du dossier décompressé, sans le dossier lui-même. Les dossiers `artists` et `supabase` doivent apparaître à la racine du dépôt.
5. Cliquez sur **Commit changes**.

## Étape 4 — Déployer sur Vercel

1. Sur vercel.com, cliquez sur **Add New… → Project**, puis importez `wma-music`.
2. Choisissez **Framework Preset : Other**. Laissez **Build Command** et **Output Directory** vides.
3. Cliquez sur **Deploy**.

À chaque nouveau commit sur GitHub, Vercel republie automatiquement le site.

**Adresse conseillée :** `music.wmaua.com`.

1. Dans **Vercel → Settings → Domains**, ajoutez `music.wmaua.com`.
2. Suivez l'indication DNS que Vercel affiche. En général, il s'agit d'un enregistrement CNAME vers `cname.vercel-dns.com`.

## Étape 5 — Connexion et adresses de retour

Dans **Supabase → Authentication → URL Configuration** :

- **Site URL** : `https://music.wmaua.com`, ou l'adresse `.vercel.app` si vous n'avez pas encore de domaine.
- **Redirect URLs** : ajoutez la même adresse, ainsi que l'adresse `.vercel.app` du projet.

**Connexion avec Google :**

1. Ouvrez **Authentication → Providers → Google** et activez-le.
2. Collez le *Client ID* et le *Client secret* de Google Cloud.
3. Dans Google Cloud, ajoutez l'URI de redirection autorisée affichée par Supabase. Elle ressemble à `https://abcd1234.supabase.co/auth/v1/callback`.

## Étape 6 — Devenir administrateur WMA

1. Ouvrez WMA MUSIC et créez un compte avec **worldmusicactus@gmail.com**. Confirmez l'e-mail reçu, ou connectez-vous avec Google.
2. Dans le **SQL Editor** de Supabase, exécutez :

```sql
update public.music_profiles set role = 'admin'
where id = (select id from auth.users where email = 'worldmusicactus@gmail.com');
```

3. Rechargez l'application : **WMA ADMIN** apparaît dans le menu.

Vous pourrez ensuite nommer d'autres administrateurs depuis **WMA ADMIN → Auditeurs**.

## Étape 7 — Ajouter de vraies chansons

Allez dans **WMA ADMIN → Gestion des musiques → AJOUTER UNE CHANSON**.

- **Formats** : MP3, M4A, AAC et OGG sont envoyés tels quels, jusqu'à 50 Mo. WAV et FLAC sont convertis automatiquement pour le streaming.
- **Pistes « DÉMO »** : vous pouvez les supprimer dans Gestion des musiques une fois votre vrai catalogue en ligne.
- **Photo de BELMA** : ajoutez-la dans **WMA ADMIN → Artistes → BELMA → Modifier**.

---

## Sécurité

- **Catalogue** : seuls les administrateurs peuvent ajouter, modifier, publier ou supprimer. Les brouillons ne sont visibles que d'eux.
- **Droits de diffusion** : la base refuse de publier une chanson dont les droits ne sont pas confirmés.
- **Fichiers audio** : ils sont dans un espace privé, et chaque écoute passe par une adresse temporaire valable 6 heures.
- **Profils** : chaque auditeur ne peut modifier que ses propres favoris, playlists et écoutes. Personne ne peut se nommer administrateur depuis l'application.

## Limites à connaître

- **Comptage des écoutes** : il est fait par l'application.
  - Règles : 30 secondes d'écoute réelle, une écoute par titre toutes les 30 minutes, 200 par jour au maximum.
  - Un utilisateur techniquement averti pourrait modifier ses propres compteurs. Pour des statistiques certifiées (paiement des artistes, par exemple), il faudra déplacer ce comptage côté serveur, dans une fonction Supabase.
- **Auditeurs non connectés** : ils peuvent écouter, mais leurs écoutes ne sont pas comptées.
- **Offre gratuite de Supabase** : l'espace de stockage et le trafic sont limités. Vérifiez vos quotas dans le tableau de bord Supabase avant d'importer un gros catalogue.
- **Version claude.ai** : celle utilisée pendant la conception a sa propre base. Elle n'est pas synchronisée avec Supabase.
