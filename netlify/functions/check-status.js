// GET /.netlify/functions/check-status?taskId=...
// Polls Suno for task status.
// Returns: { status: 'pending' | 'streaming' | 'complete' | 'error', tracks?: [], message?: string }

exports.handler = async (event) => {
  const taskId = event.queryStringParameters?.taskId;
  if (!taskId) return json(400, { error: 'taskId required' });

  try {
    const res = await fetch(`https://api.sunoapi.org/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${process.env.SUNO_API_KEY}` },
    });
    const data = await res.json();

    if (data.code !== 200) {
      return json(500, { error: data.msg || 'Suno error', raw: data });
    }

    const status = data.data?.status;
    const sunoData = data.data?.response?.sunoData || [];

    // Normalize tracks to snake_case the frontend expects.
    const tracks = sunoData.map(t => ({
      id: t.id,
      audio_url: t.audioUrl,
      stream_audio_url: t.streamAudioUrl,
      image_url: t.imageUrl,
      prompt: t.prompt,
      model_name: t.modelName,
      title: t.title,
      tags: t.tags,
      duration: t.duration,
      createTime: t.createTime,
    }));

    let mappedStatus;
    if (status === 'PENDING' || status === 'TEXT_SUCCESS') mappedStatus = 'pending';
    else if (status === 'FIRST_SUCCESS') mappedStatus = 'streaming';
    else if (status === 'SUCCESS') mappedStatus = 'complete';
    else mappedStatus = 'error';

    return json(200, {
      status: mappedStatus,
      raw_status: status,
      tracks,
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
