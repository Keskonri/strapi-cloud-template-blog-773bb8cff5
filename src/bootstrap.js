'use strict';

const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');
const { categories, authors, articles, global, about } = require('../data/data.json');

async function seedExampleApp() {
  const shouldImportSeedData = await isFirstRun();

  // FORCE IMPORT - Temporarily bypassing the first run check
  if (true) {
    try {
      console.log('Setting up the template...');
      await importSeedData();
      console.log('Ready to go');
    } catch (error) {
      console.log('Could not import seed data');
      console.error(error);
    }
  } else {
    console.log(
      'Seed data has already been imported. We cannot reimport unless you clear your database first.'
    );
  }
}

async function isFirstRun() {
  const pluginStore = strapi.store({
    environment: strapi.config.environment,
    type: 'type',
    name: 'setup',
  });
  const initHasRun = await pluginStore.get({ key: 'initHasRun' });
  await pluginStore.set({ key: 'initHasRun', value: true });
  return !initHasRun;
}

async function setPublicPermissions(newPermissions) {
  // Find the ID of the public role
  const publicRole = await strapi.query('plugin::users-permissions.role').findOne({
    where: {
      type: 'public',
    },
  });

  // Create the new permissions and link them to the public role
  const allPermissionsToCreate = [];
  Object.keys(newPermissions).map((controller) => {
    const actions = newPermissions[controller];
    const permissionsToCreate = actions.map((action) => {
      return strapi.query('plugin::users-permissions.permission').create({
        data: {
          action: `api::${controller}.${controller}.${action}`,
          role: publicRole.id,
        },
      });
    });
    allPermissionsToCreate.push(...permissionsToCreate);
  });
  await Promise.all(allPermissionsToCreate);
}

function getFileSizeInBytes(filePath) {
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats['size'];
  return fileSizeInBytes;
}

function getFileData(fileName) {
  const filePath = path.join('data', 'uploads', fileName);
  // Parse the file metadata
  const size = getFileSizeInBytes(filePath);
  const ext = fileName.split('.').pop();
  const mimeType = mime.lookup(ext || '') || '';

  return {
    filepath: filePath,
    originalFileName: fileName,
    size,
    mimetype: mimeType,
  };
}

async function uploadFile(file, name) {
  return strapi
    .plugin('upload')
    .service('upload')
    .upload({
      files: file,
      data: {
        fileInfo: {
          alternativeText: `An image uploaded to Strapi called ${name}`,
          caption: name,
          name,
        },
      },
    });
}

// Create an entry and attach files if there are any
async function createEntry({ model, entry }) {
  try {
    // Actually create the entry in Strapi
    await strapi.documents(`api::${model}.${model}`).create({
      data: entry,
    });
  } catch (error) {
    console.error({ model, entry, error });
  }
}

async function checkFileExistsBeforeUpload(files) {
  const existingFiles = [];
  const uploadedFiles = [];
  const filesCopy = [...files];

  for (const fileName of filesCopy) {
    // Check if the file already exists in Strapi
    const fileWhereName = await strapi.query('plugin::upload.file').findOne({
      where: {
        name: fileName.replace(/\..*$/, ''),
      },
    });

    if (fileWhereName) {
      // File exists, don't upload it
      existingFiles.push(fileWhereName);
    } else {
      // File doesn't exist, upload it
      const fileData = getFileData(fileName);
      const fileNameNoExtension = fileName.split('.').shift();
      const [file] = await uploadFile(fileData, fileNameNoExtension);
      uploadedFiles.push(file);
    }
  }
  const allFiles = [...existingFiles, ...uploadedFiles];
  // If only one file then return only that file
  return allFiles.length === 1 ? allFiles[0] : allFiles;
}

async function updateBlocks(blocks) {
  const updatedBlocks = [];
  for (const block of blocks) {
    if (block.__component === 'shared.media') {
      const uploadedFiles = await checkFileExistsBeforeUpload([block.file]);
      // Copy the block to not mutate directly
      const blockCopy = { ...block };
      // Replace the file name on the block with the actual file
      blockCopy.file = uploadedFiles;
      updatedBlocks.push(blockCopy);
    } else if (block.__component === 'shared.slider') {
      // Get files already uploaded to Strapi or upload new files
      const existingAndUploadedFiles = await checkFileExistsBeforeUpload(block.files);
      // Copy the block to not mutate directly
      const blockCopy = { ...block };
      // Replace the file names on the block with the actual files
      blockCopy.files = existingAndUploadedFiles;
      // Push the updated block
      updatedBlocks.push(blockCopy);
    } else {
      // Just push the block as is
      updatedBlocks.push(block);
    }
  }

  return updatedBlocks;
}

async function importArticles() {
  for (const article of articles) {
    const cover = await checkFileExistsBeforeUpload([`${article.slug}.jpg`]);
    const updatedBlocks = await updateBlocks(article.blocks);

    await createEntry({
      model: 'article',
      entry: {
        ...article,
        cover,
        blocks: updatedBlocks,
        // Make sure it's not a draft
        publishedAt: Date.now(),
      },
    });
  }
}

async function importGlobal() {
  const favicon = await checkFileExistsBeforeUpload(['favicon.png']);
  const shareImage = await checkFileExistsBeforeUpload(['default-image.png']);
  return createEntry({
    model: 'global',
    entry: {
      ...global,
      favicon,
      // Make sure it's not a draft
      publishedAt: Date.now(),
      defaultSeo: {
        ...global.defaultSeo,
        shareImage,
      },
    },
  });
}

async function importAbout() {
  const updatedBlocks = await updateBlocks(about.blocks);

  await createEntry({
    model: 'about',
    entry: {
      ...about,
      blocks: updatedBlocks,
      // Make sure it's not a draft
      publishedAt: Date.now(),
    },
  });
}

async function importCategories() {
  for (const category of categories) {
    await createEntry({ model: 'category', entry: category });
  }
}

async function importAuthors() {
  for (const author of authors) {
    const avatar = await checkFileExistsBeforeUpload([author.avatar]);

    await createEntry({
      model: 'author',
      entry: {
        ...author,
        avatar,
      },
    });
  }
}

async function importPacks() {
  console.log('📦 Creating initial packs (FR)...');

  const packsFR = [
    {
      title: 'Pack Essentiel',
      slug: 'pack-essentiel',
      subtitle: 'Votre présence digitale clé en main',
      description: 'Idéal pour les petits établissements (< 20 chambres) souhaitant lancer leur présence en ligne avec un site professionnel et performant.',
      period: 'À partir de 1 500€',
      currency: 'EUR',
      popular: false,
      category: 'Site vitrine',
      order: 1,
      delay: '2-3 semaines',
      idealFor: 'Petits établissements (< 20 chambres), lancement rapide',
      features: [
        { feature: 'Site vitrine 5 pages responsive', included: true },
        { feature: 'Design sur-mesure aux couleurs de votre établissement', included: true },
        { feature: 'Galerie photos optimisée', included: true },
        { feature: 'Formulaire de contact sécurisé', included: true },
        { feature: 'SEO de base (balises, meta descriptions)', included: true },
        { feature: 'Google Analytics & Search Console', included: true },
        { feature: 'Formation à la gestion du site', included: true },
        { feature: 'Support 3 mois inclus', included: true },
        { feature: 'Système de réservation en ligne', included: false },
        { feature: 'Blog & Content marketing', included: false },
        { feature: 'Multilingue', included: false },
      ],
      ctaText: 'Démarrer mon projet',
      ctaUrl: '/contact',
      publishedAt: Date.now(),
    },
    {
      title: 'Pack Performance',
      slug: 'pack-performance',
      subtitle: 'Boostez vos réservations directes',
      description: 'La solution complète pour les hôtels et resorts souhaitant maximiser leurs réservations directes et réduire leur dépendance aux OTA.',
      period: 'À partir de 3 500€',
      currency: 'EUR',
      popular: true,
      category: 'Site avec booking',
      order: 2,
      delay: '4-6 semaines',
      idealFor: 'Hôtels 3-4*, restaurants gastronomiques, spas',
      features: [
        { feature: 'Tout du Pack Essentiel', included: true },
        { feature: 'Moteur de réservation intégré', included: true },
        { feature: 'Gestion des disponibilités en temps réel', included: true },
        { feature: 'Paiement en ligne sécurisé (Stripe)', included: true },
        { feature: 'Site multilingue (2 langues)', included: true },
        { feature: 'Blog intégré pour content marketing', included: true },
        { feature: 'Optimisation SEO avancée', included: true },
        { feature: 'Intégration Channel Manager (optionnel)', included: true },
        { feature: 'Emails automatiques de confirmation', included: true },
        { feature: 'Support 12 mois prioritaire', included: true },
        { feature: 'Stratégie marketing digital', included: false },
      ],
      ctaText: 'Démarrer mon projet',
      ctaUrl: '/contact',
      publishedAt: Date.now(),
    },
    {
      title: 'Pack Premium',
      slug: 'pack-premium',
      subtitle: 'Solution enterprise tout-inclus',
      description: 'Pour les groupes hôteliers et établissements prestigieux exigeant une solution digitale d\'exception avec accompagnement dédié.',
      period: 'Sur devis (à partir de 7 000€)',
      currency: 'EUR',
      popular: false,
      category: 'Solution complète',
      order: 3,
      delay: '6-10 semaines',
      idealFor: 'Hôtels 4-5*, boutique-hôtels, palaces, marques de luxe',
      features: [
        { feature: 'Tout du Pack Performance', included: true },
        { feature: 'Design premium ultra-personnalisé', included: true },
        { feature: 'Développement sur-mesure', included: true },
        { feature: 'Multilingue illimité', included: true },
        { feature: 'Intégrations PMS avancées', included: true },
        { feature: 'Dashboard analytics personnalisé', included: true },
        { feature: 'Stratégie SEO & content 12 mois', included: true },
        { feature: 'Campagnes Google Ads incluses', included: true },
        { feature: 'Formation équipe complète', included: true },
        { feature: 'Support dédié illimité', included: true },
        { feature: 'Chef de projet attitré', included: true },
      ],
      ctaText: 'Démarrer mon projet',
      ctaUrl: '/contact',
      publishedAt: Date.now(),
    },
  ];

  for (const pack of packsFR) {
    await createEntry({ model: 'pack', entry: pack });
  }
}

async function importPacksEN() {
  console.log('📦 Creating initial packs (EN)...');

  const packsEN = [
    {
      title: 'Essential Pack',
      slug: 'essential-pack',
      subtitle: 'Your turnkey digital presence',
      description: 'Ideal for small establishments (< 20 rooms) looking to launch their online presence with a professional and high-performing website.',
      period: 'From €1,500',
      currency: 'EUR',
      popular: false,
      category: 'Showcase website',
      order: 1,
      delay: '2-3 weeks',
      idealFor: 'Small establishments (< 20 rooms), quick launch',
      features: [
        { feature: '5-page responsive showcase website', included: true },
        { feature: 'Custom design in your brand colors', included: true },
        { feature: 'Optimized photo gallery', included: true },
        { feature: 'Secure contact form', included: true },
        { feature: 'Basic SEO (tags, meta descriptions)', included: true },
        { feature: 'Google Analytics & Search Console', included: true },
        { feature: 'Website management training', included: true },
        { feature: '3-month support included', included: true },
        { feature: 'Online booking system', included: false },
        { feature: 'Blog & Content marketing', included: false },
        { feature: 'Multilingual', included: false },
      ],
      ctaText: 'Start my project',
      ctaUrl: '/contact',
      locale: 'en',
      publishedAt: Date.now(),
    },
    {
      title: 'Performance Pack',
      slug: 'performance-pack',
      subtitle: 'Boost your direct bookings',
      description: 'The complete solution for hotels and resorts looking to maximize direct bookings and reduce OTA dependence.',
      period: 'From €3,500',
      currency: 'EUR',
      popular: true,
      category: 'Website with booking',
      order: 2,
      delay: '4-6 weeks',
      idealFor: '3-4* hotels, gourmet restaurants, spas',
      features: [
        { feature: 'Everything from Essential Pack', included: true },
        { feature: 'Integrated booking engine', included: true },
        { feature: 'Real-time availability management', included: true },
        { feature: 'Secure online payment (Stripe)', included: true },
        { feature: 'Multilingual website (2 languages)', included: true },
        { feature: 'Integrated blog for content marketing', included: true },
        { feature: 'Advanced SEO optimization', included: true },
        { feature: 'Channel Manager integration (optional)', included: true },
        { feature: 'Automated confirmation emails', included: true },
        { feature: '12-month priority support', included: true },
        { feature: 'Digital marketing strategy', included: false },
      ],
      ctaText: 'Start my project',
      ctaUrl: '/contact',
      locale: 'en',
      publishedAt: Date.now(),
    },
    {
      title: 'Premium Pack',
      slug: 'premium-pack',
      subtitle: 'All-inclusive enterprise solution',
      description: 'For hotel groups and prestigious establishments requiring an exceptional digital solution with dedicated support.',
      period: 'Custom quote (from €7,000)',
      currency: 'EUR',
      popular: false,
      category: 'Complete solution',
      order: 3,
      delay: '6-10 weeks',
      idealFor: '4-5* hotels, boutique hotels, luxury properties, premium brands',
      features: [
        { feature: 'Everything from Performance Pack', included: true },
        { feature: 'Ultra-customized premium design', included: true },
        { feature: 'Custom development', included: true },
        { feature: 'Unlimited multilingual', included: true },
        { feature: 'Advanced PMS integrations', included: true },
        { feature: 'Custom analytics dashboard', included: true },
        { feature: '12-month SEO & content strategy', included: true },
        { feature: 'Google Ads campaigns included', included: true },
        { feature: 'Complete team training', included: true },
        { feature: 'Unlimited dedicated support', included: true },
        { feature: 'Dedicated project manager', included: true },
      ],
      ctaText: 'Start my project',
      ctaUrl: '/contact',
      locale: 'en',
      publishedAt: Date.now(),
    },
  ];

  for (const pack of packsEN) {
    await createEntry({ model: 'pack', entry: pack });
  }
}

async function importProjects() {
  console.log('🏨 Creating initial projects...');

  const projects = [
    {
      title: 'Refonte Site Web - Hôtel Le Royal Paris',
      slug: 'hotel-royal-paris',
      category: 'Hôtellerie de luxe',
      client: 'Hôtel Le Royal Paris',
      year: '2024',
      description: 'Transformation digitale complète d\'un palace parisien historique. Création d\'un site vitrine premium avec système de réservation directe, galerie photos immersive et expérience mobile optimisée.',
      content: `## Le Challenge\n\nL'Hôtel Le Royal Paris, établissement 5 étoiles situé sur les Champs-Élysées, souffrait d'une dépendance excessive aux OTA (plus de 70% des réservations) et d'un site web vieillissant ne reflétant pas le standing de l'établissement.\n\n## Notre Solution\n\nNous avons développé une plateforme web moderne intégrant :\n\n- **Design premium** : Interface élégante reflétant le luxe de l'établissement\n- **Moteur de réservation** : Système de booking intégré avec gestion des disponibilités en temps réel\n- **Galerie immersive** : Parcours photo 360° des suites et espaces communs\n- **Performance optimale** : Temps de chargement < 2 secondes, score PageSpeed 95+\n- **Multilingue** : FR, EN, ZH pour cibler la clientèle internationale\n\n## Les Résultats\n\nAprès 6 mois de mise en ligne :\n\n- **+156%** de réservations directes\n- **-42%** de commissions OTA\n- **€87,000** d'économies annuelles\n- **4.8/5** satisfaction client (Google Reviews)`,
      tags: ['Hôtellerie de luxe', 'Réservation en ligne', 'Site vitrine', 'Design premium', 'SEO', 'Multilingue'],
      projectUrl: 'https://hotel-royal-paris.fr',
      publishedAt: Date.now(),
    },
    {
      title: 'Site Web & Booking - Palais Zen Resort',
      slug: 'palais-zen-marrakech',
      category: 'Resort & Spa',
      client: 'Palais Zen Resort & Spa',
      year: '2023',
      description: 'Création d\'une plateforme de réservation complète pour un resort 5* à Marrakech. Intégration d\'un moteur de réservation spa, gestion des forfaits bien-être, et optimisation SEO ciblant les marchés français et européens.',
      content: `## Le Contexte\n\nPalais Zen Resort & Spa, établissement haut de gamme de 120 chambres à Marrakech, cherchait à augmenter ses réservations directes et à promouvoir ses offres spa auprès d'une clientèle européenne aisée.\n\n## Notre Approche\n\n- **Stratégie visuelle** : Mise en avant des espaces zen et des soins spa\n- **Booking intelligent** : Packages chambres + spa en un clic\n- **Content marketing** : Blog bien-être et guides Marrakech\n- **SEO ciblé** : Positionnement sur "spa luxe marrakech", "resort bien-être"\n\n## Impact Mesuré\n\n- **+203%** de trafic organique en 12 mois\n- **+89%** de réservations spa en ligne\n- **€124,000** de CA additionnel annuel\n- **3.2x** ROI première année`,
      tags: ['Resort', 'Spa', 'Réservation en ligne', 'Content marketing', 'SEO international', 'Maroc'],
      projectUrl: 'https://palais-zen-marrakech.com',
      publishedAt: Date.now(),
    },
    {
      title: 'Boutique Hotel - La Villa des Vignes',
      slug: 'villa-vignes-bordeaux',
      category: 'Boutique Hotel',
      client: 'La Villa des Vignes',
      year: '2024',
      description: 'Développement d\'un site web authentique pour un boutique hotel de 15 chambres au cœur des vignobles bordelais. Focus sur l\'œnotourisme et les expériences locales avec un système de réservation simplifié.',
      content: `## Le Projet\n\nPetit établissement familial de charme, La Villa des Vignes souhaitait moderniser sa présence en ligne tout en conservant son authenticité et son âme locale.\n\n## Notre Réalisation\n\n- **Storytelling visuel** : Photos authentiques du domaine et des vignobles\n- **Expériences** : Mise en avant des dégustations et visites guidées\n- **Réservation simple** : Parcours user-friendly adapté aux mobiles\n- **Local SEO** : Optimisation pour "hotel vignobles bordeaux", "œnotourisme"\n\n## Performances\n\n- **+67%** de réservations directes\n- **91%** taux de satisfaction\n- Top 3 Google "hotel vignoble bordeaux"`,
      tags: ['Boutique Hotel', 'Œnotourisme', 'Bordeaux', 'SEO local', 'Storytelling', 'Expérience client'],
      projectUrl: 'https://villa-vignes-bordeaux.fr',
      publishedAt: Date.now(),
    },
  ];

  for (const project of projects) {
    await createEntry({ model: 'project', entry: project });
  }
}

async function importSeedData() {
  // Allow read of application content types
  await setPublicPermissions({
    article: ['find', 'findOne'],
    category: ['find', 'findOne'],
    author: ['find', 'findOne'],
    global: ['find', 'findOne'],
    about: ['find', 'findOne'],
    pack: ['find', 'findOne'],
    project: ['find', 'findOne'],
  });

  // Create all entries
  await importCategories();
  await importAuthors();
  await importArticles();
  await importGlobal();
  await importAbout();
  await importPacks();
  await importPacksEN();
  await importProjects();
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  await seedExampleApp();
  await app.destroy();

  process.exit(0);
}


module.exports = async () => {
  await seedExampleApp();
};
