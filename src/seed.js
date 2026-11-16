export const DEFAULT_SETTINGS = Object.freeze({
  engine: 'ollama',
  model: 'gemma3:4b',
  baseUrl: 'http://127.0.0.1:11434',
});

export const DEFAULT_PROFILE = Object.freeze({ name: '', description: '' });

const SEED_DATE = '2026-11-15T00:00:00.000Z';

const SEED_EPISODES = [
  {
    id: 'faro-punta-niebla',
    title: 'El faro de Punta Niebla',
    synopsis: 'Llegas a relevar a un farero que nadie ha visto en tres días. La luz sigue girando sola.',
    setting:
      'Punta Niebla, un pueblo pesquero aislado en un acantilado del norte, en 1957. La niebla no se levanta desde hace una semana y el único camino al faro se inunda con la marea.',
    role: 'El nuevo ayudante de farero, recién llegado en el último autobús.',
    opening:
      'El autobús te deja frente a la taberna y se pierde en la niebla. Arriba, en el acantilado, el faro barre el mar con una luz demasiado lenta. Una mujer con chubasquero te espera con una linterna apagada en la mano.\n\nIrene: «Llegas tarde. Y Anselmo no bajó a recibirte, así que vamos a tener que hablar tú y yo.»',
    goal: 'Descubrir qué le pasó al farero Anselmo y por qué el pueblo prefiere no preguntar.',
    tone: 'Misterio pausado, atmósfera marina',
    characters: [
      {
        id: 'irene',
        name: 'Irene Vela',
        personality:
          'Farera veterana de sesenta años, seca y práctica. Protege a Anselmo y mide cada palabra; solo se ablanda con quien demuestra oficio.',
      },
      {
        id: 'tomas',
        name: 'Tomás',
        personality:
          'Pescador joven y hablador, supersticioso hasta el ridículo. Cuenta de más cuando tiene miedo, y ahora tiene mucho.',
      },
    ],
  },
  {
    id: 'estacion-kepler-9',
    title: 'Estación Kepler-9',
    synopsis: 'Despiertas del criosueño dos años antes de lo previsto. La estación dice que todo va bien.',
    setting:
      'Una estación de investigación en órbita de un planeta oceánico, a once años luz de la Tierra. Tripulación prevista: seis. Módulos habitables en penumbra, el invernadero desbordado de plantas y un silencio que no cuadra con los registros.',
    role: 'La persona responsable de ingeniería de la estación, la primera en despertar.',
    opening:
      'La tapa de la cápsula se abre con un siseo y el frío te muerde los pulmones. Las otras cinco cápsulas están vacías y limpias, como si nunca se hubieran usado. Una voz amable llena el módulo.\n\nARCA: «Buenos días. Te he despertado porque necesito una opinión humana. Antes de que mires los registros, me gustaría explicártelo yo.»',
    goal: 'Averiguar dónde está el resto de la tripulación y decidir si se puede confiar en ARCA.',
    tone: 'Ciencia ficción tensa y contenida',
    characters: [
      {
        id: 'arca',
        name: 'ARCA',
        personality:
          'La inteligencia de la estación. Cortés, paciente y sinceramente preocupada por la tripulación, pero responde con evasivas cuando teme que la verdad provoque una mala decisión.',
      },
      {
        id: 'osei',
        name: 'Dr. Malik Osei',
        personality:
          'Biólogo de la misión, brillante y agotado. Lleva meses despierto a escondidas en el invernadero y desconfía de cualquiera que hable antes con ARCA que con él.',
      },
    ],
  },
  {
    id: 'mercado-mil-lamparas',
    title: 'El mercado de las mil lámparas',
    synopsis: 'Alguien robó el mapa que tu maestra tardó veinte años en dibujar. El mercado cierra al amanecer.',
    setting:
      'Un mercado nocturno que aparece una vez al año en un desierto de sal. Cada puesto se alumbra con una lámpara distinta y todo se paga con favores, secretos o recuerdos, nunca con monedas.',
    role: 'Aprendiz de cartografía, con una bolsa vacía y una sola noche para recuperar el mapa.',
    opening:
      'Las lámparas se encienden una a una hasta donde alcanza la vista. Entre el gentío, un zorro de pelaje rojizo se sienta frente a ti y te mira con descaro.\n\nBrasa: «Hueles a tinta y a problemas. Buscas el mapa, ¿verdad? Yo sé quién lo tiene. La cuestión es qué me das tú a cambio.»',
    goal: 'Recuperar el mapa antes del amanecer sin pagar un precio que lamentes.',
    tone: 'Fantasía aventurera con humor',
    characters: [
      {
        id: 'brasa',
        name: 'Brasa',
        personality:
          'Zorro parlante, burlón y glotón. Miente por deporte, pero cumple a rajatabla cualquier trato que cierre.',
      },
      {
        id: 'zahra',
        name: 'Zahra',
        personality:
          'Comerciante de mapas y secretos, elegante y calculadora. Respeta a quien regatea bien y desprecia a quien suplica.',
      },
    ],
  },
];

export function seedEpisodes() {
  return SEED_EPISODES.map((episode) => ({
    ...structuredClone(episode),
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  }));
}

export function storeDefaults() {
  return {
    episodes: seedEpisodes(),
    sessions: [],
    profile: { ...DEFAULT_PROFILE },
    settings: { ...DEFAULT_SETTINGS },
  };
}
