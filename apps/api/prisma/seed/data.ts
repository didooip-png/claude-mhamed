/**
 * Données de démonstration FICTIVES (§16) : produits génériques identifiés par leur DCI,
 * laboratoires, fournisseurs et clients imaginaires, e-mails en @example.com.
 */

export const LABS = [
  'Laboratoires Atlas',
  'Carthage Pharma',
  'Médina Santé',
  'Sahel Labs',
  'Nord Pharma',
  'Oasis Génériques',
  'Kairouan Bio',
];

export const CATEGORIES: {
  name: string;
  kind: 'MEDICINE' | 'PARAPHARMACY' | 'MEDICAL_DEVICE' | 'OTHER';
}[] = [
  { name: 'Antalgiques et antipyrétiques', kind: 'MEDICINE' },
  { name: 'Antibiotiques', kind: 'MEDICINE' },
  { name: 'Anti-inflammatoires', kind: 'MEDICINE' },
  { name: 'Cardiologie', kind: 'MEDICINE' },
  { name: 'Diabétologie', kind: 'MEDICINE' },
  { name: 'Gastro-entérologie', kind: 'MEDICINE' },
  { name: 'Respiratoire et ORL', kind: 'MEDICINE' },
  { name: 'Dermatologie', kind: 'MEDICINE' },
  { name: 'Neurologie et psychiatrie', kind: 'MEDICINE' },
  { name: 'Vitamines et compléments', kind: 'PARAPHARMACY' },
  { name: 'Hygiène et soins', kind: 'PARAPHARMACY' },
  { name: 'Dispositifs médicaux', kind: 'MEDICAL_DEVICE' },
];

export const THERAPEUTIC_CLASSES = [
  'Antalgique',
  'Antibiotique bêta-lactamine',
  'Macrolide',
  'AINS',
  'Antihypertenseur',
  'Hypolipémiant',
  'Antidiabétique oral',
  'IPP',
  'Antihistaminique',
  'Corticoïde',
  'Anxiolytique',
  'Vitamine',
];

export interface SeedProduct {
  dci: string;
  name: string;
  dosage: string;
  form: string;
  presentation: string;
  category: number;
  tva: number;
  price: number; // prix de vente TTC en millimes
  unitsPerPack?: number;
  sellByUnit?: boolean;
  prescription?: boolean;
  controlled?: 'A' | 'B' | 'C';
  coldChain?: boolean;
  returnable?: boolean;
  minStock: number;
  therapeuticClass?: number;
  popularity: number; // 1 (rare) à 10 (très vendu)
}

type Variant = [dosage: string, form: string, presentation: string, price: number];

function family(
  dci: string,
  brand: string,
  category: number,
  variants: Variant[],
  extra: Partial<SeedProduct> & { popularity: number; minStock?: number },
): SeedProduct[] {
  return variants.map(([dosage, form, presentation, price]) => ({
    dci,
    name: `${brand} ${dosage}`,
    dosage,
    form,
    presentation,
    category,
    tva: 700,
    price,
    minStock: extra.minStock ?? 5,
    ...extra,
  }));
}

export const PRODUCTS: SeedProduct[] = [
  ...family(
    'Paracétamol',
    'Paracétamol Atlas',
    0,
    [
      ['500 mg', 'Comprimé', 'Boîte de 20', 1450],
      ['1 g', 'Comprimé', 'Boîte de 8', 1900],
      ['1 g', 'Comprimé effervescent', 'Tube de 8', 2650],
      ['2,4 %', 'Sirop', 'Flacon de 100 ml', 2350],
      ['300 mg', 'Suppositoire', 'Boîte de 10', 2100],
    ],
    { popularity: 10, minStock: 30, therapeuticClass: 0 },
  ),
  ...family(
    'Paracétamol + codéine',
    'Codéparacet',
    0,
    [['500 mg / 30 mg', 'Comprimé', 'Boîte de 16', 4850]],
    { popularity: 4, prescription: true, controlled: 'B', therapeuticClass: 0 },
  ),
  ...family(
    'Ibuprofène',
    'Ibuprofène Sahel',
    2,
    [
      ['200 mg', 'Comprimé pelliculé', 'Boîte de 20', 2600],
      ['400 mg', 'Comprimé pelliculé', 'Boîte de 20', 3900],
      ['100 mg/5 ml', 'Suspension buvable', 'Flacon de 150 ml', 4750],
    ],
    { popularity: 9, minStock: 20, therapeuticClass: 3 },
  ),
  ...family(
    'Diclofénac',
    'Diclofénac Nord',
    2,
    [
      ['50 mg', 'Comprimé', 'Boîte de 30', 3450],
      ['75 mg/3 ml', 'Injectable', 'Boîte de 5 ampoules', 5200],
      ['1 %', 'Gel', 'Tube de 50 g', 5900],
    ],
    { popularity: 6, prescription: true, therapeuticClass: 3 },
  ),
  ...family(
    'Kétoprofène',
    'Kétoprofène Oasis',
    2,
    [
      ['100 mg', 'Comprimé', 'Boîte de 30', 6800],
      ['2,5 %', 'Gel', 'Tube de 60 g', 7400],
    ],
    { popularity: 4, prescription: true, therapeuticClass: 3 },
  ),
  ...family(
    'Amoxicilline',
    'Amoxicilline Carthage',
    1,
    [
      ['500 mg', 'Gélule', 'Boîte de 12', 4950],
      ['1 g', 'Comprimé', 'Boîte de 12', 7900],
      ['250 mg/5 ml', 'Poudre', 'Flacon de 60 ml', 5600],
    ],
    { popularity: 8, prescription: true, minStock: 15, therapeuticClass: 1 },
  ),
  ...family(
    'Amoxicilline + acide clavulanique',
    'Amoxiclav Carthage',
    1,
    [
      ['1 g / 125 mg', 'Comprimé', 'Boîte de 12', 13900],
      ['500 mg / 62,5 mg', 'Comprimé', 'Boîte de 16', 11200],
      ['100 mg/12,5 mg/ml', 'Poudre', 'Flacon de 60 ml', 9800],
    ],
    { popularity: 7, prescription: true, therapeuticClass: 1 },
  ),
  ...family(
    'Azithromycine',
    'Azithromycine Médina',
    1,
    [
      ['250 mg', 'Comprimé', 'Boîte de 6', 11500],
      ['500 mg', 'Comprimé', 'Boîte de 3', 12400],
      ['200 mg/5 ml', 'Poudre', 'Flacon de 15 ml', 9900],
    ],
    { popularity: 5, prescription: true, therapeuticClass: 2 },
  ),
  ...family(
    'Ciprofloxacine',
    'Ciprofloxacine Atlas',
    1,
    [['500 mg', 'Comprimé', 'Boîte de 10', 8900]],
    { popularity: 3, prescription: true },
  ),
  ...family(
    'Céfixime',
    'Céfixime Kairouan',
    1,
    [
      ['200 mg', 'Comprimé', 'Boîte de 8', 14600],
      ['100 mg/5 ml', 'Poudre', 'Flacon de 40 ml', 11800],
    ],
    { popularity: 3, prescription: true, therapeuticClass: 1 },
  ),
  ...family(
    'Métronidazole',
    'Métronidazole Sahel',
    1,
    [
      ['500 mg', 'Comprimé', 'Boîte de 14', 3600],
      ['125 mg/5 ml', 'Suspension buvable', 'Flacon de 120 ml', 3900],
    ],
    { popularity: 4, prescription: true },
  ),
  ...family(
    'Amlodipine',
    'Amlodipine Nord',
    3,
    [
      ['5 mg', 'Comprimé', 'Boîte de 30', 7800],
      ['10 mg', 'Comprimé', 'Boîte de 30', 9600],
    ],
    { popularity: 6, prescription: true, therapeuticClass: 4, minStock: 10 },
  ),
  ...family(
    'Périndopril',
    'Périndopril Atlas',
    3,
    [
      ['4 mg', 'Comprimé', 'Boîte de 30', 11900],
      ['8 mg', 'Comprimé', 'Boîte de 30', 15400],
    ],
    { popularity: 4, prescription: true, therapeuticClass: 4 },
  ),
  ...family(
    'Losartan',
    'Losartan Oasis',
    3,
    [
      ['50 mg', 'Comprimé', 'Boîte de 28', 10500],
      ['100 mg', 'Comprimé', 'Boîte de 28', 13800],
    ],
    { popularity: 4, prescription: true, therapeuticClass: 4 },
  ),
  ...family(
    'Bisoprolol',
    'Bisoprolol Médina',
    3,
    [
      ['5 mg', 'Comprimé', 'Boîte de 30', 8700],
      ['10 mg', 'Comprimé', 'Boîte de 30', 10200],
    ],
    { popularity: 4, prescription: true, therapeuticClass: 4 },
  ),
  ...family(
    'Atorvastatine',
    'Atorvastatine Carthage',
    3,
    [
      ['10 mg', 'Comprimé', 'Boîte de 30', 12500],
      ['20 mg', 'Comprimé', 'Boîte de 30', 16800],
      ['40 mg', 'Comprimé', 'Boîte de 30', 21900],
    ],
    { popularity: 5, prescription: true, therapeuticClass: 5 },
  ),
  ...family(
    'Rosuvastatine',
    'Rosuvastatine Sahel',
    3,
    [['10 mg', 'Comprimé', 'Boîte de 30', 18900]],
    { popularity: 3, prescription: true, therapeuticClass: 5 },
  ),
  ...family(
    'Acide acétylsalicylique',
    'Aspirine Cardio Atlas',
    3,
    [
      ['100 mg', 'Comprimé', 'Boîte de 30', 3900],
      ['500 mg', 'Comprimé effervescent', 'Tube de 20', 3200],
    ],
    { popularity: 6 },
  ),
  ...family('Clopidogrel', 'Clopidogrel Nord', 3, [['75 mg', 'Comprimé', 'Boîte de 30', 19500]], {
    popularity: 3,
    prescription: true,
  }),
  ...family(
    'Metformine',
    'Metformine Kairouan',
    4,
    [
      ['500 mg', 'Comprimé', 'Boîte de 50', 5400],
      ['850 mg', 'Comprimé', 'Boîte de 50', 6900],
      ['1000 mg', 'Comprimé', 'Boîte de 30', 6300],
    ],
    { popularity: 7, prescription: true, therapeuticClass: 6, minStock: 15 },
  ),
  ...family(
    'Gliclazide',
    'Gliclazide Atlas',
    4,
    [
      ['30 mg LM', 'Comprimé', 'Boîte de 30', 8400],
      ['60 mg LM', 'Comprimé', 'Boîte de 30', 12800],
    ],
    { popularity: 4, prescription: true, therapeuticClass: 6 },
  ),
  ...family(
    'Insuline glargine',
    'Glargine Pen',
    4,
    [['100 UI/ml', 'Injectable', 'Boîte de 5 stylos', 98500]],
    { popularity: 2, prescription: true, coldChain: true, returnable: false },
  ),
  ...family(
    'Oméprazole',
    'Oméprazole Médina',
    5,
    [
      ['20 mg', 'Gélule', 'Boîte de 14', 6200],
      ['20 mg', 'Gélule', 'Boîte de 28', 10900],
    ],
    { popularity: 7, therapeuticClass: 7, minStock: 10 },
  ),
  ...family(
    'Ésoméprazole',
    'Ésoméprazole Oasis',
    5,
    [
      ['20 mg', 'Comprimé', 'Boîte de 14', 9800],
      ['40 mg', 'Comprimé', 'Boîte de 14', 13500],
    ],
    { popularity: 5, prescription: true, therapeuticClass: 7 },
  ),
  ...family(
    'Dompéridone',
    'Dompéridone Sahel',
    5,
    [
      ['10 mg', 'Comprimé', 'Boîte de 40', 4700],
      ['1 mg/ml', 'Suspension buvable', 'Flacon de 200 ml', 5100],
    ],
    { popularity: 5 },
  ),
  ...family('Lopéramide', 'Lopéramide Nord', 5, [['2 mg', 'Gélule', 'Boîte de 20', 3300]], {
    popularity: 5,
  }),
  ...family(
    'Phloroglucinol',
    'Phloroglucinol Atlas',
    5,
    [
      ['80 mg', 'Comprimé', 'Boîte de 20', 4900],
      ['80 mg', 'Comprimé', 'Boîte de 10 lyoc', 5600],
    ],
    { popularity: 6 },
  ),
  ...family(
    'Diosmectite',
    'Diosmectite Carthage',
    5,
    [['3 g', 'Sachet', 'Boîte de 30 sachets', 6400]],
    { popularity: 5 },
  ),
  ...family(
    'Cétirizine',
    'Cétirizine Kairouan',
    6,
    [
      ['10 mg', 'Comprimé', 'Boîte de 15', 4200],
      ['1 mg/ml', 'Solution buvable', 'Flacon de 60 ml', 4600],
    ],
    { popularity: 6, therapeuticClass: 8 },
  ),
  ...family(
    'Desloratadine',
    'Desloratadine Médina',
    6,
    [['5 mg', 'Comprimé', 'Boîte de 15', 7900]],
    { popularity: 4, therapeuticClass: 8 },
  ),
  ...family(
    'Salbutamol',
    'Salbutamol Inhal',
    6,
    [['100 µg/dose', 'Inhalateur', 'Flacon de 200 doses', 7900]],
    { popularity: 5, prescription: true },
  ),
  ...family(
    'Budésonide',
    'Budésonide Nasal',
    6,
    [['64 µg/dose', 'Spray', 'Flacon de 120 doses', 11600]],
    { popularity: 3, prescription: true, therapeuticClass: 9 },
  ),
  ...family(
    'Carbocistéine',
    'Carbocistéine Sahel',
    6,
    [
      ['5 %', 'Sirop', 'Flacon de 200 ml', 4400],
      ['2 %', 'Sirop', 'Flacon de 125 ml (enfant)', 3900],
    ],
    { popularity: 6 },
  ),
  ...family(
    'Sérum physiologique',
    'Sérum physiologique',
    6,
    [['0,9 %', 'Solution buvable', 'Boîte de 30 unidoses', 3500]],
    { popularity: 7 },
  ),
  ...family(
    'Bétaméthasone',
    'Bétaméthasone Crème',
    7,
    [['0,05 %', 'Crème', 'Tube de 30 g', 4800]],
    { popularity: 3, prescription: true, therapeuticClass: 9 },
  ),
  ...family(
    'Acide fusidique',
    'Acide fusidique Atlas',
    7,
    [['2 %', 'Crème', 'Tube de 15 g', 6900]],
    { popularity: 4, prescription: true },
  ),
  ...family(
    'Éconazole',
    'Éconazole Oasis',
    7,
    [
      ['1 %', 'Crème', 'Tube de 30 g', 5400],
      ['150 mg', 'Ovule', 'Boîte de 3', 6100],
    ],
    { popularity: 3 },
  ),
  ...family(
    'Alprazolam',
    'Alprazolam Nord',
    8,
    [
      ['0,25 mg', 'Comprimé', 'Boîte de 30', 3800],
      ['0,5 mg', 'Comprimé', 'Boîte de 30', 4900],
    ],
    { popularity: 3, prescription: true, controlled: 'A', therapeuticClass: 10, returnable: false },
  ),
  ...family('Bromazépam', 'Bromazépam Médina', 8, [['6 mg', 'Comprimé', 'Boîte de 30', 4300]], {
    popularity: 2,
    prescription: true,
    controlled: 'A',
    therapeuticClass: 10,
    returnable: false,
  }),
  ...family('Sertraline', 'Sertraline Kairouan', 8, [['50 mg', 'Comprimé', 'Boîte de 28', 16500]], {
    popularity: 2,
    prescription: true,
    controlled: 'C',
  }),
  ...family('Prégabaline', 'Prégabaline Sahel', 8, [['75 mg', 'Gélule', 'Boîte de 28', 18900]], {
    popularity: 2,
    prescription: true,
    controlled: 'B',
  }),
  ...family(
    'Vitamine C',
    'Vitamine C Oasis',
    9,
    [
      ['500 mg', 'Comprimé effervescent', 'Tube de 20', 5900],
      ['1 g', 'Comprimé effervescent', 'Tube de 10', 6400],
    ],
    { popularity: 6, therapeuticClass: 11, tva: 1900 },
  ),
  ...family(
    'Vitamine D3',
    'Vitamine D3 Atlas',
    9,
    [
      ['200 000 UI', 'Solution buvable', 'Ampoule de 2 ml', 3900],
      ['1 000 UI', 'Gouttes', 'Flacon de 20 ml', 6800],
    ],
    { popularity: 5, therapeuticClass: 11 },
  ),
  ...family(
    'Magnésium + vitamine B6',
    'Magné B6 Nord',
    9,
    [['48 mg / 5 mg', 'Comprimé', 'Boîte de 60', 9800]],
    { popularity: 5, tva: 1900 },
  ),
  ...family(
    'Fer (sulfate ferreux)',
    'Fer Carthage',
    9,
    [['80 mg', 'Comprimé', 'Boîte de 30', 5600]],
    { popularity: 4 },
  ),
  ...family(
    'Acide folique',
    'Acide folique Médina',
    9,
    [['5 mg', 'Comprimé', 'Boîte de 20', 2900]],
    { popularity: 4 },
  ),
  ...family('Multivitamines', 'Multivit Famille', 9, [['—', 'Comprimé', 'Boîte de 30', 14900]], {
    popularity: 3,
    tva: 1900,
  }),
  ...family(
    'Chlorhexidine',
    'Chlorhexidine Solution',
    10,
    [['0,12 %', 'Solution buvable', 'Flacon de 300 ml (bain de bouche)', 6900]],
    { popularity: 4, tva: 1900 },
  ),
  ...family(
    'Povidone iodée',
    'Povidone iodée',
    10,
    [['10 %', 'Solution buvable', 'Flacon de 125 ml', 5400]],
    { popularity: 4 },
  ),
  ...family(
    'Gel hydroalcoolique',
    'Gel mains Oasis',
    10,
    [
      ['70 %', 'Gel', 'Flacon de 250 ml', 4900],
      ['70 %', 'Gel', 'Flacon de 500 ml', 7900],
    ],
    { popularity: 5, tva: 1900 },
  ),
  ...family('Crème hydratante', 'Crème Émolliente', 10, [['—', 'Crème', 'Tube de 200 ml', 18500]], {
    popularity: 3,
    tva: 1900,
  }),
  ...family(
    'Écran solaire',
    'Écran solaire SPF 50',
    10,
    [['SPF 50+', 'Crème', 'Tube de 50 ml', 32000]],
    { popularity: 3, tva: 1900 },
  ),
  ...family(
    'Compresses stériles',
    'Compresses stériles',
    11,
    [['7,5 x 7,5 cm', 'Autre', 'Boîte de 50', 6500]],
    { popularity: 5, tva: 1900 },
  ),
  ...family(
    'Bande élastique',
    'Bande de contention',
    11,
    [['10 cm x 4 m', 'Autre', 'Rouleau', 7800]],
    { popularity: 3, tva: 1900 },
  ),
  ...family(
    'Seringue',
    'Seringue stérile',
    11,
    [
      ['5 ml', 'Autre', 'Boîte de 100', 16500],
      ['2 ml', 'Autre', 'Boîte de 100', 14500],
    ],
    { popularity: 3, tva: 1900 },
  ),
  ...family('Thermomètre', 'Thermomètre digital', 11, [['—', 'Autre', 'À l’unité', 12900]], {
    popularity: 2,
    tva: 1900,
  }),
  ...family(
    'Bandelettes glycémie',
    'Bandelettes Gluco',
    11,
    [['—', 'Autre', 'Boîte de 50', 42500]],
    { popularity: 3, tva: 1900 },
  ),
  ...family('Test de grossesse', 'Test de grossesse', 11, [['—', 'Autre', 'Boîte de 1', 7500]], {
    popularity: 3,
    tva: 1900,
    returnable: false,
  }),
  ...family(
    'Masque chirurgical',
    'Masque chirurgical',
    11,
    [['Type IIR', 'Autre', 'Boîte de 50', 9500]],
    { popularity: 4, tva: 1900 },
  ),
  ...family('Tramadol', 'Tramadol Médina', 0, [['50 mg', 'Gélule', 'Boîte de 20', 5200]], {
    popularity: 2,
    prescription: true,
    controlled: 'B',
    returnable: false,
  }),
  ...family('Naproxène', 'Naproxène Atlas', 2, [['550 mg', 'Comprimé', 'Boîte de 20', 6100]], {
    popularity: 3,
    prescription: true,
    therapeuticClass: 3,
  }),
  ...family(
    'Méloxicam',
    'Méloxicam Nord',
    2,
    [
      ['7,5 mg', 'Comprimé', 'Boîte de 20', 5800],
      ['15 mg', 'Comprimé', 'Boîte de 20', 7600],
    ],
    { popularity: 3, prescription: true, therapeuticClass: 3 },
  ),
  ...family(
    'Prednisolone',
    'Prednisolone Sahel',
    2,
    [
      ['20 mg', 'Comprimé effervescent', 'Boîte de 20', 5900],
      ['5 mg', 'Comprimé', 'Boîte de 30', 4100],
    ],
    { popularity: 4, prescription: true, therapeuticClass: 9 },
  ),
  ...family('Doxycycline', 'Doxycycline Oasis', 1, [['100 mg', 'Comprimé', 'Boîte de 10', 6700]], {
    popularity: 3,
    prescription: true,
  }),
  ...family(
    'Clarithromycine',
    'Clarithromycine Kairouan',
    1,
    [
      ['500 mg', 'Comprimé', 'Boîte de 14', 17800],
      ['250 mg/5 ml', 'Poudre', 'Flacon de 60 ml', 13900],
    ],
    { popularity: 3, prescription: true, therapeuticClass: 2 },
  ),
  ...family(
    'Nitrofurantoïne',
    'Nitrofurantoïne Atlas',
    1,
    [['50 mg', 'Gélule', 'Boîte de 30', 5900]],
    { popularity: 2, prescription: true },
  ),
  ...family('Fosfomycine', 'Fosfomycine Nord', 1, [['3 g', 'Sachet', 'Boîte de 1 sachet', 8900]], {
    popularity: 3,
    prescription: true,
  }),
  ...family(
    'Valsartan',
    'Valsartan Carthage',
    3,
    [
      ['80 mg', 'Comprimé', 'Boîte de 30', 12600],
      ['160 mg', 'Comprimé', 'Boîte de 30', 15900],
    ],
    { popularity: 3, prescription: true, therapeuticClass: 4 },
  ),
  ...family(
    'Hydrochlorothiazide',
    'Hydrochlorothiazide Médina',
    3,
    [['25 mg', 'Comprimé', 'Boîte de 30', 3900]],
    { popularity: 3, prescription: true, therapeuticClass: 4 },
  ),
  ...family(
    'Furosémide',
    'Furosémide Sahel',
    3,
    [
      ['40 mg', 'Comprimé', 'Boîte de 30', 3500],
      ['20 mg/2 ml', 'Injectable', 'Boîte de 5 ampoules', 4600],
    ],
    { popularity: 3, prescription: true },
  ),
  ...family('Simvastatine', 'Simvastatine Oasis', 3, [['20 mg', 'Comprimé', 'Boîte de 28', 9400]], {
    popularity: 2,
    prescription: true,
    therapeuticClass: 5,
  }),
  ...family(
    'Sitagliptine',
    'Sitagliptine Kairouan',
    4,
    [['100 mg', 'Comprimé', 'Boîte de 28', 39800]],
    { popularity: 2, prescription: true, therapeuticClass: 6 },
  ),
  ...family(
    'Glimépiride',
    'Glimépiride Atlas',
    4,
    [
      ['2 mg', 'Comprimé', 'Boîte de 30', 7900],
      ['4 mg', 'Comprimé', 'Boîte de 30', 11500],
    ],
    { popularity: 3, prescription: true, therapeuticClass: 6 },
  ),
  ...family(
    'Insuline rapide',
    'Insuline Rapide Pen',
    4,
    [['100 UI/ml', 'Injectable', 'Boîte de 5 stylos', 76500]],
    { popularity: 2, prescription: true, coldChain: true, returnable: false },
  ),
  ...family(
    'Pantoprazole',
    'Pantoprazole Nord',
    5,
    [
      ['40 mg', 'Comprimé', 'Boîte de 14', 9200],
      ['20 mg', 'Comprimé', 'Boîte de 28', 11800],
    ],
    { popularity: 4, prescription: true, therapeuticClass: 7 },
  ),
  ...family(
    'Métoclopramide',
    'Métoclopramide Carthage',
    5,
    [['10 mg', 'Comprimé', 'Boîte de 40', 3100]],
    { popularity: 3, prescription: true },
  ),
  ...family(
    'Lactulose',
    'Lactulose Médina',
    5,
    [['10 g/15 ml', 'Solution buvable', 'Flacon de 200 ml', 6200]],
    { popularity: 3 },
  ),
  ...family('Macrogol', 'Macrogol Sahel', 5, [['10 g', 'Sachet', 'Boîte de 20 sachets', 8900]], {
    popularity: 3,
  }),
  ...family('Siméticone', 'Siméticone Oasis', 5, [['40 mg', 'Comprimé', 'Boîte de 50', 5400]], {
    popularity: 3,
  }),
  ...family('Loratadine', 'Loratadine Atlas', 6, [['10 mg', 'Comprimé', 'Boîte de 15', 3900]], {
    popularity: 5,
    therapeuticClass: 8,
  }),
  ...family(
    'Montélukast',
    'Montélukast Kairouan',
    6,
    [
      ['10 mg', 'Comprimé', 'Boîte de 28', 19500],
      ['4 mg', 'Sachet', 'Boîte de 28', 17500],
    ],
    { popularity: 2, prescription: true },
  ),
  ...family('Ambroxol', 'Ambroxol Nord', 6, [['30 mg/5 ml', 'Sirop', 'Flacon de 200 ml', 4700]], {
    popularity: 5,
  }),
  ...family(
    'Xylométazoline',
    'Xylométazoline Nasal',
    6,
    [['0,1 %', 'Spray', 'Flacon de 10 ml', 3900]],
    { popularity: 5 },
  ),
  ...family(
    'Pastilles gorge',
    'Pastilles gorge miel citron',
    6,
    [['—', 'Comprimé', 'Boîte de 24', 4200]],
    { popularity: 6, tva: 1900 },
  ),
  ...family(
    'Aciclovir',
    'Aciclovir Carthage',
    7,
    [
      ['5 %', 'Crème', 'Tube de 2 g', 3600],
      ['200 mg', 'Comprimé', 'Boîte de 25', 9800],
    ],
    { popularity: 3 },
  ),
  ...family('Hydrocortisone', 'Hydrocortisone Crème', 7, [['1 %', 'Crème', 'Tube de 15 g', 3900]], {
    popularity: 3,
    therapeuticClass: 9,
  }),
  ...family('Terbinafine', 'Terbinafine Médina', 7, [['1 %', 'Crème', 'Tube de 15 g', 7200]], {
    popularity: 2,
  }),
  ...family('Mupirocine', 'Mupirocine Sahel', 7, [['2 %', 'Pommade', 'Tube de 15 g', 8300]], {
    popularity: 2,
    prescription: true,
  }),
  ...family('Zolpidem', 'Zolpidem Oasis', 8, [['10 mg', 'Comprimé', 'Boîte de 14', 5400]], {
    popularity: 2,
    prescription: true,
    controlled: 'A',
    returnable: false,
  }),
  ...family(
    'Escitalopram',
    'Escitalopram Atlas',
    8,
    [['10 mg', 'Comprimé', 'Boîte de 28', 21500]],
    { popularity: 2, prescription: true, controlled: 'C' },
  ),
  ...family(
    'Lévothyroxine',
    'Lévothyroxine Nord',
    8,
    [
      ['50 µg', 'Comprimé', 'Boîte de 30', 3800],
      ['100 µg', 'Comprimé', 'Boîte de 30', 4200],
    ],
    { popularity: 4, prescription: true },
  ),
  ...family('Zinc', 'Zinc Plus', 9, [['15 mg', 'Gélule', 'Boîte de 30', 11900]], {
    popularity: 3,
    tva: 1900,
  }),
  ...family('Oméga 3', 'Oméga 3 Marin', 9, [['1 000 mg', 'Gélule', 'Boîte de 60', 24500]], {
    popularity: 2,
    tva: 1900,
  }),
  ...family('Probiotiques', 'Probiotique Flore', 9, [['—', 'Gélule', 'Boîte de 20', 17900]], {
    popularity: 3,
    tva: 1900,
  }),
  ...family(
    'Calcium + vitamine D3',
    'Calcium D3 Atlas',
    9,
    [['500 mg / 400 UI', 'Comprimé', 'Boîte de 60', 13500]],
    { popularity: 3 },
  ),
  ...family(
    'Solution hydroalcoolique',
    'Alcool 70°',
    10,
    [['70 %', 'Solution buvable', 'Flacon de 250 ml', 2900]],
    { popularity: 4, tva: 1900 },
  ),
  ...family(
    'Shampoing antipoux',
    'Antipoux Lotion',
    10,
    [['—', 'Solution buvable', 'Flacon de 100 ml', 16500]],
    { popularity: 2, tva: 1900 },
  ),
  ...family(
    'Dentifrice gencives',
    'Dentifrice Gencives',
    10,
    [['—', 'Gel', 'Tube de 75 ml', 8900]],
    { popularity: 3, tva: 1900 },
  ),
  ...family(
    'Lait bébé 1er âge',
    'Lait infantile 1',
    10,
    [['0-6 mois', 'Poudre', 'Boîte de 400 g', 24900]],
    { popularity: 4, tva: 0, returnable: false },
  ),
  ...family(
    'Lait bébé 2e âge',
    'Lait infantile 2',
    10,
    [['6-12 mois', 'Poudre', 'Boîte de 400 g', 23900]],
    { popularity: 4, tva: 0, returnable: false },
  ),
  ...family('Couches bébé', 'Couches Taille 4', 10, [['7-18 kg', 'Autre', 'Paquet de 44', 29500]], {
    popularity: 3,
    tva: 1900,
  }),
  ...family('Pansements', 'Pansements assortis', 11, [['—', 'Autre', 'Boîte de 40', 5900]], {
    popularity: 5,
    tva: 1900,
  }),
  ...family('Coton hydrophile', 'Coton hydrophile', 11, [['—', 'Autre', 'Paquet de 250 g', 4500]], {
    popularity: 4,
    tva: 1900,
  }),
  ...family('Tensiomètre', 'Tensiomètre poignet', 11, [['—', 'Autre', 'À l’unité', 89000]], {
    popularity: 1,
    tva: 1900,
  }),
  ...family('Lancettes', 'Lancettes stériles', 11, [['30G', 'Autre', 'Boîte de 100', 15900]], {
    popularity: 2,
    tva: 1900,
  }),
  ...family(
    'Aiguilles stylo insuline',
    'Aiguilles stylo 4 mm',
    11,
    [['32G', 'Autre', 'Boîte de 100', 36500]],
    { popularity: 2, tva: 1900 },
  ),
  ...family(
    'Sparadrap',
    'Sparadrap microporeux',
    11,
    [['2,5 cm x 5 m', 'Autre', 'Rouleau', 3200]],
    { popularity: 4, tva: 1900 },
  ),
];

// Quelques produits vendus à l'unité (déconditionnement, RG-07).
for (const p of PRODUCTS) {
  if (p.dci === 'Paracétamol' && p.dosage === '500 mg')
    Object.assign(p, { unitsPerPack: 20, sellByUnit: true });
  if (p.dci === 'Amoxicilline' && p.dosage === '1 g')
    Object.assign(p, { unitsPerPack: 12, sellByUnit: true });
  if (p.dci === 'Seringue') Object.assign(p, { unitsPerPack: 100, sellByUnit: true });
}

export const SUPPLIERS = [
  {
    name: 'Alpha Distribution Pharmaceutique',
    taxId: '1234567A/M/000',
    phone: '71 100 200',
    email: 'commandes@alpha-distribution.example.com',
    paymentTermsDays: 60,
    leadTimeDays: 2,
  },
  {
    name: 'Grossiste Méditerranée',
    taxId: '2345678B/M/000',
    phone: '73 200 300',
    email: 'ventes@grossiste-med.example.com',
    paymentTermsDays: 45,
    leadTimeDays: 3,
  },
  {
    name: 'Pharma Sud Répartition',
    taxId: '3456789C/M/000',
    phone: '74 300 400',
    email: 'contact@pharmasud.example.com',
    paymentTermsDays: 30,
    leadTimeDays: 4,
  },
  {
    name: 'Centrale Parapharmacie',
    taxId: '4567890D/M/000',
    phone: '71 400 500',
    email: 'pro@centrale-para.example.com',
    paymentTermsDays: 30,
    leadTimeDays: 5,
  },
  {
    name: 'Matériel Médical Plus',
    taxId: '5678901E/M/000',
    phone: '72 500 600',
    email: 'devis@mmplus.example.com',
    paymentTermsDays: 30,
    leadTimeDays: 7,
  },
];

const FIRST = [
  'Ahmed',
  'Fatma',
  'Mohamed',
  'Leila',
  'Sami',
  'Hela',
  'Youssef',
  'Mariem',
  'Nizar',
  'Ines',
  'Walid',
  'Sarra',
  'Hatem',
  'Amira',
  'Bilel',
  'Rim',
  'Khaled',
  'Olfa',
  'Anis',
  'Salma',
];
const LAST = [
  'Ben Ali',
  'Trabelsi',
  'Jaziri',
  'Mansour',
  'Hammami',
  'Bouazizi',
  'Khelifi',
  'Gharbi',
  'Chaabane',
  'Mejri',
  'Saidi',
  'Dridi',
  'Ayari',
  'Hamdi',
  'Zouari',
  'Kacem',
  'Mathlouthi',
  'Riahi',
  'Sassi',
  'Belhadj',
];

export interface SeedClient {
  type: 'INDIVIDUAL' | 'PHARMACY' | 'CLINIC' | 'HOSPITAL' | 'ASSOCIATION' | 'COMPANY';
  name: string;
  phone: string;
  email: string | null;
  consent: boolean;
  creditLimit: number;
  discountBp: number;
  paymentTermsDays: number;
  nationalIdOrTaxId: string;
}

export function seedClients(): SeedClient[] {
  const out: SeedClient[] = [];
  for (let i = 0; i < 24; i += 1) {
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[(i * 7 + Math.floor(i / FIRST.length) * 3) % LAST.length]!;
    const hasEmail = i % 3 !== 0;
    out.push({
      type: 'INDIVIDUAL',
      name: `${first} ${last}`,
      phone: `${[20, 22, 25, 50, 52, 55, 97, 98][i % 8]} ${String(100 + i * 37).padStart(3, '0')} ${String(200 + i * 53).slice(-3)}`,
      email: hasEmail
        ? `${first.toLowerCase()}.${last.toLowerCase().replace(/\s/g, '')}@example.com`
        : null,
      consent: hasEmail && i % 2 === 0,
      creditLimit: i % 5 === 0 ? 150_000 : i % 7 === 0 ? 80_000 : 0,
      discountBp: 0,
      paymentTermsDays: i % 5 === 0 ? 30 : 0,
      nationalIdOrTaxId: String(10_000_000 + i * 104_729).slice(0, 8),
    });
  }
  const pros: [SeedClient['type'], string, number, number, number][] = [
    ['CLINIC', 'Clinique Les Jasmins', 3_000_000, 500, 60],
    ['CLINIC', 'Clinique El Manar', 2_000_000, 300, 45],
    ['PHARMACY', 'Pharmacie Hannibal', 1_500_000, 800, 30],
    ['HOSPITAL', 'Centre de santé de base Ennasr', 1_000_000, 0, 90],
    ['ASSOCIATION', 'Association Espoir Santé', 500_000, 1000, 30],
    ['COMPANY', 'Société Oliviers du Sahel (infirmerie)', 800_000, 200, 30],
  ];
  pros.forEach(([type, name, limit, discount, terms], i) =>
    out.push({
      type,
      name,
      phone: `71 ${String(800 + i * 11)} ${String(400 + i * 23)}`,
      email: `comptabilite.${name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z]+/g, '-')
        .replace(/^-|-$/g, '')}@example.com`,
      consent: true,
      creditLimit: limit,
      discountBp: discount,
      paymentTermsDays: terms,
      nationalIdOrTaxId: `${9_000_000 + i * 1_311}${'ABCDEF'[i]}/A/M/000`,
    }),
  );
  return out;
}

/** Générateur pseudo-aléatoire déterministe (données reproductibles). */
export function rng(seed = 20260930) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!,
    chance: (p: number) => next() < p,
  };
}
