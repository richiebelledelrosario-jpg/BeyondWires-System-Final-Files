/* =====================================================================
   BeyondWires — LandingPageData.js
   ALL EDITABLE CONTENT for the landing page lives here.
   Load BEFORE LandingPage.js:
     <script src="LandingPageData.js" defer></script>
     <script src="LandingPage.js" defer></script>

     1. projects      — "Our Works" gallery + project detail
     2. productArt    — device drawings for the "Our Products" cards
                        (the products themselves come from the Admin "Products" tab)
     5. packages      — "Packages" cards + information window

   To add an item, copy an existing one and change the values.
   Later, any of these lists can be filled from your PHP/MySQL backend
   instead, as long as each item keeps the same fields.
   ===================================================================== */

window.BW_DATA = {

  /* =========================
     1. PROJECTS (Our Works)
     -------------------------
     images: the first image is the card + main detail image; add more
     photos to fill the thumbnail strip in the detail view.
     icon: any Material Icons Round name (videocam, fingerprint, lock,
     speaker_phone, wb_sunny, doorbell, home, settings_ethernet ...)
     ========================= */
  projects: [
    {
      id: "forthinker",
      title: "Forthinker, Inc.",
      client: "Forthinker, Inc. · Mandaluyong City",
      category: "Commercial",
      projectType: "Company Property",
      summary: "Complete security coverage for a company property.",
      description:
        "An integrated security setup for a company property: a 12-channel Dahua Technology IR CCTV package together with biometrics, smart door locks and an intercom, coordinated into one system for staff and visitors.",
      systems: [
        { name: "12-Channel Dahua IR CCTV", icon: "videocam" },
        { name: "Biometrics", icon: "fingerprint" },
        { name: "Smart Door Lock", icon: "lock" },
        { name: "Intercom", icon: "speaker_phone" }
      ],
      scope: "Supply, installation & configuration",
      status: "Completed",
      images: [
        { src: "../Assets/Forthinker.png", alt: "Forthinker, Inc. company property with installed security cameras" }
      ]
    },
    {
      id: "nuat-thai",
      title: "Nuat Thai Foot & Body Massage",
      client: "Nuat Thai Foot & Body Massage · SM San Lazaro Branch",
      category: "Commercial",
      projectType: "Wellness & Spa",
      summary: "Securing employees and customers during their time of relaxation.",
      description:
        "A 4-channel Dahua Technology IR CCTV package that keeps key areas of the spa monitored day and night, protecting employees and customers without intruding on their time to relax.",
      systems: [
        { name: "4-Channel Dahua IR CCTV", icon: "videocam" }
      ],
      scope: "Supply, installation & configuration",
      status: "Completed",
      images: [
        { src: "../Assets/NUAT THAI.png", alt: "Nuat Thai spa interior covered by a 4-channel IR CCTV system" }
      ]
    },
    {
      id: "banaga-optodent",
      title: "Bañaga Optical and Dental Clinic",
      client: "Bañaga OptoDent · Calamba, Laguna and San Juan, Batangas branches",
      category: "Commercial",
      projectType: "Optical & Dental Clinic",
      summary: "Day-and-night coverage for two clinic branches.",
      description:
        "An 8-channel Dahua Technology IR CCTV package for the Calamba, Laguna and San Juan, Batangas branches, keeping each clinic monitored for its patients and staff.",
      systems: [
        { name: "8-Channel Dahua IR CCTV", icon: "videocam" }
      ],
      scope: "Supply, installation & configuration",
      status: "Completed",
      images: [
        { src: "../Assets/banagaoptdent.png", alt: "Dome CCTV camera installed at Bañaga Optical and Dental Clinic" }
      ]
    },
    {
      id: "subway",
      title: "Subway",
      client: "Subway · MRT Ayala, Makati Branch",
      category: "Commercial",
      projectType: "Food Chain",
      summary: "Store-wide surveillance for a busy food chain branch.",
      description:
        "An 8-channel Hikvision IR CCTV package for the MRT Ayala, Makati branch, giving the store clear, round-the-clock coverage viewed from one monitor.",
      systems: [
        { name: "8-Channel Hikvision IR CCTV", icon: "videocam" }
      ],
      scope: "Supply, installation & configuration",
      status: "Completed",
      images: [
        { src: "../Assets/subway-1.jpg", alt: "Subway MRT Ayala branch store interior" },
        { src: "../Assets/subway-2.jpg", alt: "CCTV monitor showing the Subway branch camera views" }
      ]
    },
    {
      id: "la-salle-antipolo",
      title: "La Salle College Antipolo",
      client: "La Salle College Antipolo Foundation Inc. · Antipolo City",
      category: "Institutional",
      projectType: "School",
      summary: "Campus surveillance for a preschool and a senior high campus.",
      description:
        "A 12-channel Dahua Technology IR CCTV package for the Preschool Campus in San Luis and a 16-channel Dahua Technology IP CCTV package for the Senior High Campus in San Jose, Antipolo City.",
      systems: [
        { name: "12-Channel Dahua IR CCTV", icon: "videocam" },
        { name: "16-Channel Dahua IP CCTV", icon: "videocam" }
      ],
      scope: "Supply, installation & configuration",
      status: "Completed",
      images: [
        { src: "../Assets/lasalle-1.jpg", alt: "CCTV monitor showing the La Salle College Antipolo camera views" },
        { src: "../Assets/lasalle-2.jpg", alt: "Campus hallway covered by the CCTV system" }
      ]
    },
    {
      id: "san-ildefonso-police",
      title: "San Ildefonso Police Station",
      client: "San Ildefonso Police Station · San Ildefonso, Bulacan",
      category: "Government",
      projectType: "Police Station",
      summary: "Clear coverage of the station grounds and entrances.",
      description:
        "An 8-channel Dahua Technology IR CCTV package that keeps the police station's entrances and grounds monitored day and night.",
      systems: [
        { name: "8-Channel Dahua IR CCTV", icon: "videocam" }
      ],
      scope: "Supply, installation & configuration",
      status: "Completed",
      images: [
        { src: "../Assets/sanildefonso-1.jpg", alt: "San Ildefonso Police Station entrance with installed CCTV cameras" },
        { src: "../Assets/sanildefonso-2.jpg", alt: "CCTV monitor showing the station camera views" }
      ]
    },
    {
      id: "residential-security",
      title: "Residential Solar Street Lights",
      client: "Private Residence",
      category: "Residential",
      projectType: "Solar & Security",
      summary: "Street lights powered by the sun.",
      description:
        "Complete security for a residential property, paired with solar-powered street lights that keep the surroundings lit after dark without adding to the electricity bill.",
      systems: [
        { name: "Residential Security", icon: "home" },
        { name: "Solar Street Lights", icon: "wb_sunny" }
      ],
      scope: "Supply & installation",
      status: "Completed",
      images: [
        { src: "../Assets/Residential.png", alt: "Residential property with solar-powered street lights" }
      ]
    },
    {
      id: "residential-cctv",
      title: "Residential CCTV Installation",
      client: "Private Residence",
      category: "Residential",
      projectType: "Modern Home",
      summary: "Integrated protection designed for a modern home.",
      description:
        "An IR CCTV system that gives a modern home integrated, round-the-clock coverage across its entrances and surroundings.",
      systems: [
        { name: "IR CCTV", icon: "videocam" }
      ],
      scope: "Supply, installation & configuration",
      status: "Completed",
      images: [
        { src: "../Assets/residentials.png", alt: "Modern home protected by an IR CCTV system" }
      ]
    }
  ],

  /* =========================
     4. PRODUCT ILLUSTRATIONS
     -------------------------
     Simple line drawings (viewBox 120 x 90). Colours come from CSS
     (.pa-* classes) so they follow light / dark mode automatically.
     ========================= */
  productArt: {
    irCctv: `
      <rect class="pa-body" x="4" y="28" width="12" height="36" rx="3"/>
      <path class="pa-line" d="M16 46h8l8-6"/>
      <path class="pa-line" d="M26 25h68l7 6"/>
      <path class="pa-body" d="M30 30h58a8 8 0 0 1 8 8v8a8 8 0 0 1-8 8H30z"/>
      <path class="pa-thin" d="M40 46h26"/>
      <rect class="pa-body" x="93" y="30" width="15" height="24" rx="4"/>
      <circle class="pa-glass" cx="100.5" cy="42" r="7"/>
      <circle class="pa-accent" cx="100.5" cy="42" r="3"/>
      <circle class="pa-accent" cx="96" cy="33.5" r="1.2"/><circle class="pa-accent" cx="105" cy="33.5" r="1.2"/>
      <circle class="pa-accent" cx="96" cy="50.5" r="1.2"/><circle class="pa-accent" cx="105" cy="50.5" r="1.2"/>
      <path class="pa-beam" d="M108 34l14-12v40l-14-12z"/>`,

    ipCctv: `
      <rect class="pa-body" x="20" y="12" width="76" height="11" rx="4"/>
      <path class="pa-body" d="M28 23h60v9a30 30 0 0 1-60 0z"/>
      <path class="pa-glass" d="M36 33a22 22 0 0 0 44 0z"/>
      <circle class="pa-body" cx="58" cy="42" r="8"/>
      <circle class="pa-accent" cx="58" cy="42" r="3.5"/>
      <path class="pa-stroke-accent" d="M96 18h10v36"/>
      <rect class="pa-body" x="99" y="54" width="14" height="12" rx="2"/>
      <path class="pa-thin" d="M102 58v4M106 58v4M110 58v4"/>
      <path class="pa-thin" d="M92 80a12 12 0 0 1 18 0M96 84a6 6 0 0 1 10 0"/>`,

    biometrics: `
      <rect class="pa-body" x="34" y="4" width="52" height="82" rx="9"/>
      <rect class="pa-glass" x="41" y="12" width="38" height="24" rx="3"/>
      <path class="pa-thin" d="M47 20h20M47 26h13"/>
      <rect class="pa-line" x="47" y="44" width="26" height="32" rx="8"/>
      <path class="pa-stroke-accent" d="M53 56a7 7 0 0 1 14 0v5M57 66v-9a3 3 0 0 1 6 0v12M51 70v-12"/>
      <circle class="pa-accent" cx="60" cy="81" r="1.6"/>`,

    intercom: `
      <rect class="pa-body" x="10" y="16" width="100" height="58" rx="8"/>
      <rect class="pa-glass" x="18" y="24" width="56" height="42" rx="4"/>
      <circle class="pa-line" cx="46" cy="40" r="7"/>
      <path class="pa-line" d="M33 60a13 9 0 0 1 26 0"/>
      <path class="pa-thin" d="M84 28h16M84 33h16M84 38h16"/>
      <circle class="pa-body" cx="86" cy="56" r="5"/>
      <circle class="pa-body" cx="100" cy="56" r="5"/>
      <circle class="pa-accent" cx="100" cy="56" r="2"/>
      <path class="pa-line" d="M40 74v6h40v-6"/>`,

    doorbell: `
      <path class="pa-thin" d="M33 54a12 12 0 0 0 0 18M27 49a19 19 0 0 0 0 28M87 54a12 12 0 0 1 0 18M93 49a19 19 0 0 1 0 28"/>
      <rect class="pa-body" x="44" y="4" width="32" height="82" rx="16"/>
      <circle class="pa-glass" cx="60" cy="22" r="9"/>
      <circle class="pa-accent" cx="60" cy="22" r="3.5"/>
      <path class="pa-thin" d="M54 38h12M54 43h12"/>
      <circle class="pa-body" cx="60" cy="63" r="10"/>
      <circle class="pa-stroke-accent" cx="60" cy="63" r="6"/>`,

    smartLock: `
      <path class="pa-thin" d="M22 2v86M22 2h70"/>
      <rect class="pa-body" x="38" y="6" width="32" height="80" rx="7"/>
      <rect class="pa-glass" x="43" y="12" width="22" height="34" rx="3"/>
      <g class="pa-accent">
        <circle cx="49" cy="18" r="1.7"/><circle cx="54" cy="18" r="1.7"/><circle cx="59" cy="18" r="1.7"/>
        <circle cx="49" cy="25" r="1.7"/><circle cx="54" cy="25" r="1.7"/><circle cx="59" cy="25" r="1.7"/>
        <circle cx="49" cy="32" r="1.7"/><circle cx="54" cy="32" r="1.7"/><circle cx="59" cy="32" r="1.7"/>
        <circle cx="54" cy="39" r="1.7"/>
      </g>
      <path class="pa-body" d="M64 54h38a5 5 0 0 1 0 10H64z"/>
      <circle class="pa-body" cx="56" cy="59" r="6"/>
      <rect class="pa-line" x="48" y="70" width="12" height="9" rx="3"/>`,

    solarLight: `
      <path class="pa-beam" d="M80 27h32l10 50H70z"/>
      <path class="pa-line" d="M40 88V14M30 88h20"/>
      <path class="pa-body" d="M10 10l32-7 4 15-32 7z"/>
      <path class="pa-glass" d="M10 10l32-7 4 15-32 7z"/>
      <path class="pa-thin" d="M18 8.3l4 15M26 6.5l4 15M34 4.8l4 15M12 17.5l32-7"/>
      <path class="pa-line" d="M40 30c12-9 30-10 42-8"/>
      <path class="pa-body" d="M78 19h32a4 4 0 0 1 4 4v4H78z"/>
      <path class="pa-stroke-accent" d="M84 27h22"/>`,

    accessories: `
      <circle class="pa-line" cx="32" cy="48" r="18"/>
      <circle class="pa-thin" cx="32" cy="48" r="12"/>
      <circle class="pa-thin" cx="32" cy="48" r="6"/>
      <path class="pa-line" d="M50 44c14 0 14-18 30-18"/>
      <path class="pa-line" d="M50 52c14 0 14 20 30 20"/>
      <rect class="pa-body" x="80" y="18" width="24" height="17" rx="3"/>
      <path class="pa-thin" d="M86 22v5M90 22v5M94 22v5M98 22v5"/>
      <path class="pa-accent" d="M104 22h6v9h-6z"/>
      <rect class="pa-body" x="80" y="64" width="18" height="16" rx="4"/>
      <rect class="pa-accent" x="98" y="68" width="10" height="8" rx="2"/>
      <path class="pa-stroke-accent" d="M108 72h6"/>`
  },

  /* =========================
     5. PACKAGES (same as the CCTV package poster and the Admin "Products" tab)
     -------------------------
     tier: small label above the name · icon: Material icon · price: shown on the card
     level: coverage 1–3 (bar meter) · systems: inclusions
     suitable: property types · services: what the service covers (window only)
     ========================= */
  packages: [
    {
      id: "cctv-2ch",
      tier: "Package 2",
      name: "2-Channel CCTV Package",
      price: 8500,
      icon: "videocam",
      level: 1,
      levelLabel: "2 cameras",
      summary: "Perfect for small spaces.",
      description: "Two cameras with built-in mic, a DVR and a 500GB hard drive, with all accessories and free installation.",
      systems: ["2 cameras with built-in mic", "1pc DVR", "1pc 500GB HDD", "All accessories included"],
      suitable: ["Small spaces"],
      services: ["Free installation", "1-year product warranty", "90-day service warranty"]
    },
    {
      id: "cctv-3ch",
      tier: "Package 3",
      name: "3-Channel CCTV Package",
      price: 12500,
      icon: "videocam",
      level: 2,
      levelLabel: "3 cameras",
      summary: "Ideal for homes & small businesses.",
      description: "Three cameras with built-in mic, a DVR and a 500GB hard drive, with all accessories and free installation.",
      systems: ["3 cameras with built-in mic", "1pc DVR", "1pc 500GB HDD", "All accessories included"],
      suitable: ["Homes", "Small businesses"],
      services: ["Free installation", "1-year product warranty", "90-day service warranty"]
    },
    {
      id: "cctv-4ch",
      tier: "Package 4",
      name: "4-Channel CCTV Package",
      price: 16500,
      icon: "videocam",
      level: 3,
      levelLabel: "4 cameras",
      summary: "Complete coverage for your property.",
      description: "Four cameras with built-in mic, a DVR and a 500GB hard drive, with all accessories and free installation.",
      systems: ["4 cameras with built-in mic", "1pc DVR", "1pc 500GB HDD", "All accessories included"],
      suitable: ["Homes", "Businesses"],
      services: ["Free installation", "1-year product warranty", "90-day service warranty"]
    }
  ]
};