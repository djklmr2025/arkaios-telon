import { createData } from '/data.js';
import { h } from '/dom.js';
import {
  coverEditor,
  coverNode,
  forgetScenes,
  hasScene,
  imagesEnabled,
  requestScene,
  sceneFigure,
  setImagesEnabled,
} from '/pictures.js';
import { parseCrossoverDraft } from '/shared/crossover.js';

const MAX_CHARACTERS = 6;
const NOTICE_MS = 4000;
const OLLAMA_DEFAULTS = { model: 'gemma3:4b', baseUrl: 'http://127.0.0.1:11434' };
const SLOW_HINT = 'Escribiendo… con el motor local puede tardar uno o dos minutos.';

const view = document.getElementById('view');
const noticeBox = document.getElementById('notice');
let noticeTimer = null;
let activeStream = null;
let data = null;
let pendingDraft = null;

const picturesOn = () => imagesEnabled(data.mode);

function notify(message, isError = false) {
  clearTimeout(noticeTimer);
  noticeBox.textContent = message;
  noticeBox.className = isError ? 'notice error' : 'notice';
  noticeBox.hidden = false;
  noticeTimer = setTimeout(() => {
    noticeBox.hidden = true;
  }, NOTICE_MS);
}

async function guarded(action) {
  try {
    await action();
  } catch (err) {
    notify(err.message, true);
  }
}

function paragraphs(text) {
  return text.split(/\n{2,}/).map((block) => h('p', {}, block));
}

function pageHead(title, lead) {
  return [h('h1', {}, title), h('p', { class: 'lead' }, lead)];
}

async function startSession(episodeId, mode, characterId) {
  const session = await data.createSession(episodeId, mode, characterId);
  location.hash = `#/jugar/${session.id}`;
}

function episodeCard(episode) {
  const remove = () =>
    guarded(async () => {
      if (!confirm(`¿Borrar "${episode.title}"? Las partidas ya empezadas se conservan.`)) return;
      await data.deleteEpisode(episode.id);
      await renderLibrary();
    });
  return h(
    'article',
    { class: 'card' },
    coverNode(episode, picturesOn()),
    episode.tone && h('span', { class: 'tag' }, episode.tone),
    h('h2', {}, episode.title),
    h('p', {}, episode.synopsis),
    h(
      'div',
      { class: 'cast', 'aria-label': 'Hablar a solas con un personaje' },
      episode.characters.map((character) =>
        h(
          'button',
          { class: 'chip', onclick: () => guarded(() => startSession(episode.id, 'chat', character.id)) },
          `Hablar con ${character.name}`,
        ),
      ),
    ),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'primary', onclick: () => guarded(() => startSession(episode.id, 'episode')) }, 'Jugar'),
      h('a', { class: 'button', href: `#/crear/${episode.id}` }, 'Editar'),
      h('button', { class: 'quiet', onclick: remove }, 'Borrar'),
    ),
  );
}

async function renderLibrary() {
  const episodes = await data.listEpisodes();
  const body = episodes.length
    ? h('div', { class: 'grid' }, episodes.map(episodeCard))
    : h('p', { class: 'empty' }, 'No hay episodios. Crea el primero en la pestaña Crear.');
  view.replaceChildren(
    ...pageHead('Biblioteca', 'Elige un episodio y entra en escena. Aquí no hay monedas: juega cuanto quieras.'),
    episodes.length > 1 &&
      h('p', { class: 'toolbar' }, h('a', { class: 'button', href: '#/cruce' }, 'Cruzar dos mundos')),
    body,
  );
}

function sessionRow(session) {
  const remove = () =>
    guarded(async () => {
      if (!confirm(`¿Borrar la partida "${session.title}"?`)) return;
      await data.deleteSession(session.id);
      forgetScenes(session.id);
      await renderSessions();
    });
  return h(
    'li',
    { class: 'row' },
    h('div', { class: 'row-text' }, h('h3', {}, session.title), h('p', {}, session.preview || 'Sin mensajes todavía.')),
    h('a', { class: 'button', href: `#/jugar/${session.id}` }, 'Continuar'),
    h('button', { class: 'quiet', onclick: remove }, 'Borrar'),
  );
}

async function renderSessions() {
  const sessions = await data.listSessions();
  const body = sessions.length
    ? h('ul', { class: 'list' }, sessions.map(sessionRow))
    : h('p', { class: 'empty' }, 'Todavía no has empezado ninguna partida.');
  view.replaceChildren(...pageHead('Partidas', 'Tus historias y charlas en curso se guardan en este equipo.'), body);
}

function messageNode(message, session) {
  const kind = message.role === 'user' ? 'player' : 'story';
  const scene = session && hasScene(session.id, message.id) && sceneFigure(session, message);
  return h('div', { class: `msg ${kind}` }, paragraphs(message.text), scene);
}

function createStage(session) {
  const log = h(
    'div',
    { class: 'log', 'aria-live': 'polite' },
    session.messages.map((message) => messageNode(message, session)),
  );
  let lastStory = null;
  const remember = (message, node) => {
    lastStory = { message, node };
  };
  const storyMessages = session.messages.filter((message) => message.role === 'assistant');
  if (storyMessages.length) remember(storyMessages.at(-1), [...log.querySelectorAll('.msg.story')].at(-1));
  const input = h('textarea', {
    'aria-label': 'Tu acción o diálogo',
    placeholder: session.mode === 'chat' ? 'Escribe tu mensaje…' : '¿Qué haces o dices?',
    maxlength: 2000,
  });
  const sendButton = h('button', { class: 'primary', type: 'submit' }, 'Enviar');

  function undoSend(playerBubble, text, message) {
    playerBubble.remove();
    input.value = text;
    notify(message, true);
  }

  async function requestReply(body, playerBubble) {
    const bubble = h('div', { class: 'msg story pending' }, h('p', {}, SLOW_HINT));
    log.append(bubble);
    bubble.scrollIntoView({ block: 'end' });
    sendButton.disabled = true;
    let text = '';
    try {
      const showPiece = (piece) => {
        text += piece;
        bubble.className = 'msg story';
        bubble.replaceChildren(...paragraphs(text));
      };
      activeStream = new AbortController();
      const reply = await data.reply(session.id, body, showPiece, activeStream.signal);
      const node = messageNode(reply, session);
      bubble.replaceWith(node);
      remember(reply, node);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err.rejected && playerBubble) {
        bubble.remove();
        undoSend(playerBubble, body.text, err.message);
        return;
      }
      const retry = h('button', { onclick: () => { bubble.remove(); requestReply({ retry: true }); } }, 'Reintentar');
      bubble.className = 'msg failed';
      bubble.replaceChildren(h('p', {}, err.message), retry);
    } finally {
      sendButton.disabled = false;
    }
  }

  function submit(event) {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || sendButton.disabled) return;
    input.value = '';
    const playerBubble = messageNode({ role: 'user', text });
    log.append(playerBubble);
    requestReply({ text }, playerBubble);
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) submit(event);
  });
  const illustrate = () =>
    guarded(async () => {
      if (!lastStory) throw new Error('Todavía no hay ninguna escena que ilustrar.');
      if (lastStory.node.querySelector('.scene .cover')) throw new Error('Esta escena ya está ilustrada o en camino.');
      lastStory.node.querySelector('.scene')?.remove();
      const figure = requestScene(session, lastStory.message);
      lastStory.node.append(figure);
      figure.scrollIntoView({ block: 'end' });
    });
  const tools =
    session.mode === 'episode' &&
    picturesOn() &&
    h('button', { type: 'button', class: 'quiet', onclick: illustrate }, 'Ilustrar escena');
  const form = h('form', { class: 'composer', onsubmit: submit }, input, h('div', { class: 'composer-actions' }, sendButton, tools));
  return { log, form, input, requestReply };
}

async function renderPlay(sessionId) {
  const session = await data.getSession(sessionId);
  const stage = createStage(session);
  const subtitle = session.mode === 'chat' ? `De «${session.episode.title}»` : session.episode.synopsis;
  view.replaceChildren(
    h('div', { class: 'stage-head' }, h('h1', {}, session.title), h('p', {}, subtitle)),
    stage.log,
    stage.form,
  );
  stage.input.focus();
  if (session.messages.at(-1)?.role === 'user') stage.requestReply({ retry: true });
}

function field(label, control) {
  return h('label', {}, label, control);
}

function characterFields(character = {}) {
  const box = h(
    'fieldset',
    { 'data-character-id': character.id ?? '' },
    h('legend', {}, 'Personaje'),
    field('Nombre', h('input', { name: 'characterName', required: true, maxlength: 60, value: character.name ?? '' })),
    field(
      'Personalidad y forma de hablar',
      h('textarea', { name: 'characterPersonality', required: true, maxlength: 400, value: character.personality ?? '' }),
    ),
    h('button', { type: 'button', class: 'quiet', onclick: () => box.remove() }, 'Quitar personaje'),
  );
  return box;
}

function readEpisodeForm(form) {
  const data = new FormData(form);
  const characters = [...form.querySelectorAll('fieldset[data-character-id]')].map((box) => ({
    id: box.dataset.characterId || undefined,
    name: box.querySelector('[name=characterName]').value,
    personality: box.querySelector('[name=characterPersonality]').value,
  }));
  const fields = ['title', 'tone', 'synopsis', 'setting', 'role', 'opening', 'goal'].map((key) => [key, data.get(key) ?? '']);
  return { ...Object.fromEntries(fields), characters };
}

function takeDraft() {
  const draft = pendingDraft;
  pendingDraft = null;
  return draft;
}

function castPicker(episodes, addCharacter) {
  const known = episodes.flatMap((episode) =>
    episode.characters.map((character) => ({ character, from: episode.title })),
  );
  if (known.length === 0) return null;
  const picker = h(
    'select',
    { 'aria-label': 'Añadir un personaje del elenco' },
    h('option', { value: '' }, 'Añadir del elenco…'),
    known.map(({ character, from }, index) => h('option', { value: String(index) }, `${character.name} — ${from}`)),
  );
  picker.addEventListener('change', () => {
    const chosen = known[Number(picker.value)];
    const isChoice = picker.value !== '';
    picker.value = '';
    if (isChoice && chosen) addCharacter({ name: chosen.character.name, personality: chosen.character.personality });
  });
  return picker;
}

async function renderEditor(episodeId) {
  const [stored, episodes] = await Promise.all([episodeId ? data.getEpisode(episodeId) : null, data.listEpisodes()]);
  const episode = stored ?? takeDraft() ?? { characters: [{}] };
  const cast = h('div', { class: 'list' }, episode.characters.map(characterFields));
  const addCharacter = (character) => {
    if (cast.children.length >= MAX_CHARACTERS) return notify(`Máximo ${MAX_CHARACTERS} personajes.`, true);
    cast.append(characterFields(character));
  };
  const others = episodes.filter((candidate) => candidate.id !== episodeId);
  const input = (name, max, required = true) =>
    h('input', { name, maxlength: max, required, value: episode[name] ?? '' });
  const area = (name, max, required = true) =>
    h('textarea', { name, maxlength: max, required, value: episode[name] ?? '' });
  const save = (event) => {
    event.preventDefault();
    guarded(async () => {
      await data.saveEpisode(episodeId ?? null, { ...readEpisodeForm(event.target), cover: cover.value() });
      notify('Episodio guardado.');
      location.hash = '#/';
    });
  };
  const form = h('form', { onsubmit: save });
  const cover = coverEditor(episode, () => readEpisodeForm(form), {
    generate: picturesOn(),
    onError: (err) => notify(err.message, true),
  });
  form.append(
      field('Título', input('title', 80)),
      field('Tono (opcional)', input('tone', 60, false)),
      field('Sinopsis', area('synopsis', 400)),
      field('Mundo y situación', area('setting', 4000)),
      field('Papel del protagonista', area('role', 400)),
      field('Escena inicial (lo primero que lee el jugador)', area('opening', 4000)),
      field('Meta de la historia (opcional)', area('goal', 400, false)),
      cover.node,
      cast,
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', onclick: () => addCharacter() }, 'Añadir personaje'),
        castPicker(others, addCharacter) ?? '',
        h('button', { class: 'primary', type: 'submit' }, 'Guardar episodio'),
      ),
  );
  view.replaceChildren(
    ...pageHead(episodeId ? 'Editar episodio' : 'Crear episodio', 'Describe el mundo, el papel del jugador y quién le espera en escena.'),
    form,
  );
}

async function renderCrossover() {
  const episodes = await data.listEpisodes();
  if (episodes.length < 2) {
    view.replaceChildren(h('p', { class: 'empty' }, 'Hacen falta al menos dos episodios para cruzar mundos.'));
    return;
  }
  const choice = (label, selected) => {
    const select = h('select', {}, episodes.map((episode) => h('option', { value: episode.id }, episode.title)));
    select.value = episodes[selected].id;
    return { select, node: field(label, select) };
  };
  const first = choice('Primer mundo', 0);
  const second = choice('Segundo mundo', 1);
  const progress = h('p', { class: 'hint', 'aria-live': 'polite' });
  const button = h('button', { class: 'primary', type: 'submit' }, 'Escribir el cruce');
  const submit = (event) => {
    event.preventDefault();
    const [a, b] = [first.select.value, second.select.value];
    if (a === b) return notify('Elige dos episodios distintos.', true);
    guarded(async () => {
      button.disabled = true;
      let length = 0;
      progress.textContent = 'La IA está escribiendo el cruce…';
      try {
        activeStream = new AbortController();
        const onToken = (piece) => {
          length += piece.length;
          progress.textContent = `La IA está escribiendo el cruce… ${length} caracteres.`;
        };
        const reply = await data.crossover(a, b, onToken, activeStream.signal);
        pendingDraft = parseCrossoverDraft(reply.text);
        notify('Borrador listo. Revísalo y guárdalo.');
        location.hash = '#/crear';
      } catch (err) {
        progress.textContent = '';
        if (err.name !== 'AbortError') throw err;
      } finally {
        button.disabled = false;
      }
    });
  };
  view.replaceChildren(
    ...pageHead('Cruzar dos mundos', 'Elige dos episodios y la IA redacta uno nuevo donde se encuentran. Podrás editarlo antes de guardarlo.'),
    h('form', { onsubmit: submit }, first.node, second.node, progress, h('div', { class: 'actions' }, button)),
  );
}

function profileSection(profile) {
  const save = (event) => {
    event.preventDefault();
    guarded(async () => {
      const form = new FormData(event.target);
      await data.saveProfile({ name: form.get('name'), description: form.get('description') });
      notify('Perfil guardado.');
    });
  };
  return h(
    'section',
    { class: 'section' },
    h('h2', {}, 'Tu protagonista'),
    h(
      'form',
      { onsubmit: save },
      field('Nombre', h('input', { name: 'name', maxlength: 60, value: profile.name })),
      field('Cómo eres (opcional)', h('textarea', { name: 'description', maxlength: 400, value: profile.description })),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Guardar perfil')),
    ),
  );
}

function engineStatusLine() {
  const node = h('p', { class: 'hint' }, 'Pulsa «Probar motor» para comprobar la conexión.');
  async function check() {
    node.textContent = 'Comprobando…';
    node.className = 'hint';
    const result = await data.engineStatus();
    node.textContent = result.detail;
    node.className = result.ok ? 'hint status-ok' : 'hint status-bad';
    return result;
  }
  return { node, check };
}

function engineForm(fields, status, onSave, onCheck) {
  const save = (event) => {
    event.preventDefault();
    guarded(async () => {
      await onSave();
      notify('Motor guardado.');
      await onCheck();
    });
  };
  const actions = h(
    'div',
    { class: 'actions' },
    h('button', { class: 'primary', type: 'submit' }, 'Guardar motor'),
    h('button', { type: 'button', onclick: () => guarded(onCheck) }, 'Probar motor'),
  );
  const form = h('form', { onsubmit: save }, fields, status.node, actions);
  return h('section', { class: 'section' }, h('h2', {}, 'Motor de IA'), form);
}

function localEngineSection(settings) {
  const status = engineStatusLine();
  const model = h('input', { name: 'model', required: true, maxlength: 100, value: settings.model });
  const baseUrl = h('input', { name: 'baseUrl', required: true, type: 'url', value: settings.baseUrl });
  const engine = h(
    'select',
    {
      name: 'engine',
      value: settings.engine,
      onchange: () => {
        const defaults = engine.value === 'ollama' ? OLLAMA_DEFAULTS : { model: '', baseUrl: '' };
        model.value = defaults.model;
        baseUrl.value = defaults.baseUrl;
      },
    },
    h('option', { value: 'ollama' }, 'Ollama en este equipo (gratis, lento)'),
    h('option', { value: 'openai' }, 'Proveedor compatible con OpenAI (tu clave)'),
  );
  const keyState = settings.hasApiKey ? 'Clave detectada.' : 'Clave no detectada.';
  const keyHint = `La clave del proveedor se lee de ${settings.apiKeyEnv} en el archivo .env y nunca se guarda desde aquí. ${keyState}`;
  const fields = [
    field('Motor', engine),
    field('Modelo', model),
    field('URL del motor', baseUrl),
    h('p', { class: 'hint' }, keyHint),
  ];
  const onSave = () => data.saveSettings({ engine: engine.value, model: model.value, baseUrl: baseUrl.value });
  return engineForm(fields, status, onSave, status.check);
}

function webEngineSection(settings) {
  const { label, keyUrl } = data.provider;
  const status = engineStatusLine();
  const options = h('datalist', { id: 'model-options' });
  const model = h('input', {
    name: 'model',
    required: true,
    maxlength: 100,
    list: 'model-options',
    value: settings.model,
  });
  const apiKey = h('input', {
    name: 'apiKey',
    type: 'password',
    autocomplete: 'off',
    maxlength: 300,
    value: settings.apiKey,
  });
  const check = async () => {
    const result = await status.check();
    options.replaceChildren(...result.models.map((name) => h('option', { value: name })));
  };
  const keyLink = h('a', { href: keyUrl, target: '_blank', rel: 'noopener noreferrer' }, `Consigue una clave gratuita de ${label}`);
  const privacy =
    'Tu clave, tus partidas y tus episodios se guardan solo en este navegador. La clave viaja con cada jugada únicamente para pedir la respuesta al proveedor; Telón no la almacena.';
  const fields = [
    field(`Tu clave de ${label}`, apiKey),
    h('p', { class: 'hint' }, keyLink, ' con tu cuenta. Los límites de uso los fija el proveedor.'),
    field('Modelo', model),
    options,
    h('p', { class: 'hint' }, privacy),
  ];
  const onSave = () => data.saveSettings({ model: model.value, apiKey: apiKey.value });
  return engineForm(fields, status, onSave, check);
}

function picturesSection() {
  const toggle = h('input', { type: 'checkbox' });
  toggle.checked = picturesOn();
  toggle.addEventListener('change', () =>
    guarded(async () => {
      setImagesEnabled(toggle.checked);
      notify(toggle.checked ? 'Ilustraciones activadas.' : 'Ilustraciones desactivadas.');
    }),
  );
  return h(
    'section',
    { class: 'section' },
    h('h2', {}, 'Ilustraciones'),
    h('label', { class: 'check' }, toggle, 'Generar portadas y escenas automáticamente'),
    h(
      'p',
      { class: 'hint' },
      'Las dibuja el servicio gratuito Pollinations: tu navegador le envía la descripción del episodio o de la escena. Dibuja una imagen nueva cada 45 segundos, así que varias seguidas se ponen en cola. Las portadas que subas tú no salen de este navegador.',
    ),
  );
}

async function renderSettings() {
  const [profile, settings] = await Promise.all([data.getProfile(), data.getSettings()]);
  view.replaceChildren(
    ...pageHead('Ajustes', 'Quién eres en las historias y qué motor las escribe.'),
    profileSection(profile),
    data.mode === 'web' ? webEngineSection(settings) : localEngineSection(settings),
    picturesSection(),
  );
}

const ROUTES = [
  [/^#\/partidas$/, 'sessions', renderSessions],
  [/^#\/jugar\/([\w-]+)$/, 'sessions', renderPlay],
  [/^#\/crear(?:\/([\w-]+))?$/, 'editor', renderEditor],
  [/^#\/ajustes$/, 'settings', renderSettings],
  [/^#\/cruce$/, 'library', renderCrossover],
  [/^(?:#\/?)?$/, 'library', renderLibrary],
];

async function route() {
  activeStream?.abort();
  const [pattern, nav, render] = ROUTES.find(([candidate]) => candidate.test(location.hash)) ?? ROUTES.at(-1);
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === nav) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  try {
    await render(pattern.exec(location.hash)?.[1]);
  } catch (err) {
    view.replaceChildren(h('p', { class: 'empty' }, err.message));
  }
}

async function start() {
  try {
    data = await createData();
  } catch (err) {
    view.replaceChildren(h('p', { class: 'empty' }, err.message));
    return;
  }
  window.addEventListener('hashchange', route);
  await route();
}

start();
