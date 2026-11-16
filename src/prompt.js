export const HISTORY_LIMIT = 16;
export const DEFAULT_PLAYER_NAME = 'Protagonista';

function playerName(profile) {
  return profile?.name || DEFAULT_PLAYER_NAME;
}

function playerLine(profile) {
  return profile?.description ? `Sobre ${playerName(profile)}: ${profile.description}` : '';
}

function episodePrompt(episode, profile) {
  const name = playerName(profile);
  const cast = episode.characters.map((c) => `- ${c.name}: ${c.personality}`).join('\n');
  return [
    `Eres el director y narrador de la historia interactiva "${episode.title}". Escribes siempre en español.`,
    `Mundo: ${episode.setting}`,
    episode.tone && `Tono: ${episode.tone}`,
    episode.goal && `Meta de la historia: ${episode.goal}`,
    `El jugador interpreta a ${name}. Su papel: ${episode.role}`,
    playerLine(profile),
    `Personajes que interpretas tú:\n${cast}`,
    `La historia abrió con esta escena:\n${episode.opening}`,
    [
      'Reglas:',
      '1. Narra en segunda persona y da voz a los personajes con el formato Nombre: «diálogo».',
      `2. Nunca hables, pienses ni decidas por ${name}.`,
      '3. Responde con 1 a 3 párrafos breves y haz avanzar la trama en cada respuesta.',
      `4. Termina en un momento que invite a ${name} a actuar, sin ofrecer listas de opciones.`,
      '5. Mantén la coherencia con todo lo ocurrido.',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function chatPrompt(episode, profile, character) {
  const name = playerName(profile);
  return [
    `Eres ${character.name}, personaje de la historia "${episode.title}". Escribes siempre en español.`,
    `Tu personalidad: ${character.personality}`,
    `Tu mundo: ${episode.setting}`,
    `Conversas en privado con ${name}.`,
    playerLine(profile),
    `Responde solo como ${character.name}, en primera persona y en 1 a 4 frases. No narres lo que hace ${name} ni rompas el personaje.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function findCharacter(episode, characterId) {
  return episode.characters.find((c) => c.id === characterId) ?? null;
}

export function buildSystemPrompt(session, profile) {
  if (session.mode === 'chat') {
    return chatPrompt(session.episode, profile, findCharacter(session.episode, session.characterId));
  }
  return episodePrompt(session.episode, profile);
}

function recentHistory(messages) {
  const recent = messages.slice(-HISTORY_LIMIT);
  const firstUser = recent.findIndex((m) => m.role === 'user');
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

export function buildMessages(session, profile) {
  return [
    { role: 'system', content: buildSystemPrompt(session, profile) },
    ...recentHistory(session.messages).map((m) => ({ role: m.role, content: m.text })),
  ];
}
