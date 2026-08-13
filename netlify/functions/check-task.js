// GET /.netlify/functions/check-task?kind=wav|stems&taskId=...
// Polls the non-music task types. Music generation still polls check-status.js —
// that one reads `data.status`, these read `data.successFlag`, which is why they
// can't share a handler.
//
// Returns: { status: 'pending' | 'complete' | 'error', raw_status, result, message }
//   kind=wav   → result = { wavUrl }
//   kind=stems → result = { stems: [{ name, url }], originUrl }

const SUNO_BASE = 'https://api.sunoapi.org/api/v1';

const KINDS = {
  wav: {
    path: '/wav/record-info',
    // PENDING | SUCCESS | CREATE_TASK_FAILED | GENERATE_WAV_FAILED | CALLBACK_EXCEPTION
    shape: (r) => ({ wavUrl: r?.audioWavUrl || null }),
  },
  stems: {
    path: '/vocal-removal/record-info',
    // PENDING | SUCCESS | CREATE_TASK_FAILED | GENERATE_AUDIO_FAILED | CALLBACK_EXCEPTION
    shape: (r) => {
      // Which URLs come back depends on the separation type requested, so pick up
      // whatever is present rather than assuming a fixed set.
      const MAP = {
        vocalUrl: 'Vocals',
        instrumentalUrl: 'Instrumental',
        backingVocalsUrl: 'Backing vocals',
        drumsUrl: 'Drums',
        bassUrl: 'Bass',
        guitarUrl: 'Guitar',
        keyboardUrl: 'Keyboard',
        percussionUrl: 'Percussion',
        stringsUrl: 'Strings',
        synthUrl: 'Synth',
        fxUrl: 'FX',
        brassUrl: 'Brass',
        woodwindsUrl: 'Woodwinds',
      };
      const stems = [];
      for (const [key, name] of Object.entries(MAP)) {
        if (r && r[key]) stems.push({ name, url: r[key] });
      }
      return { stems, originUrl: r?.originUrl || null };
    },
  },
};

exports.handler = async (event) => {
  const kind = event.queryStringParameters?.kind;
  const taskId = event.queryStringParameters?.taskId;

  if (!taskId) return json(400, { error: 'taskId required' });
  const spec = KINDS[kind];
  if (!spec) return json(400, { error: `kind must be one of: ${Object.keys(KINDS).join(', ')}` });

  try {
    const res = await fetch(
      `${SUNO_BASE}${spec.path}?taskId=${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${process.env.SUNO_API_KEY}` } }
    );
    const data = await res.json();

    if (data.code !== 200) {
      return json(500, { error: data.msg || 'Suno error', raw: data });
    }

    const flag = data.data?.successFlag;
    let status;
    if (flag === 'SUCCESS') status = 'complete';
    else if (flag === 'PENDING') status = 'pending';
    else status = 'error';

    return json(200, {
      status,
      raw_status: flag,
      result: status === 'complete' ? spec.shape(data.data?.response) : null,
      message: data.data?.errorMessage || null,
    });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
