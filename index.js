const express = require('express');
const cors = require('cors');
const AnimePahe = require('./lib/animepahe');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static('public'));

// Create AnimePahe instance
const pahe = new AnimePahe();

function mapErrorToStatusCode(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('not found')) return 404;
  if (text.includes('blocked') || text.includes('anti-bot')) return 503;
  if (text.includes('forbidden')) return 403;
  return 500;
}

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Animepahe API',
    endpoints: {
      search: '/search?q=naruto',
      episodes: '/episodes?session=anime-session-id',
      latest: '/latest?page=1',
      sources: '/sources?anime_session=xxx&episode_session=yyy',
      ids: '/ids?session=anime-session-id (returns AniList and MyAnimeList IDs)',
      m3u8: '/m3u8?url=kwik-url (returns m3u8 URL with required referer)',
      proxy: '/proxy?url=m3u8-or-ts-url&referer=kwik-referer (Use this to play videos)',
      health: '/health'
    },
    usage: {
      note: 'Use /proxy endpoint to stream videos through the server to bypass CORS and referrer restrictions',
      step1: 'Get M3U8 URL and referer from /m3u8 endpoint',
      step2: 'Use the returned proxy_url directly, or use /proxy?url=<m3u8-url>&referer=<referer> in your video player',
      example: '/m3u8 returns { m3u8: "...", referer: "https://kwik.si/", proxy_url: "/proxy?url=..." }'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Animepahe API is alive!' });
});

app.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    const results = await pahe.search(q);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

app.get('/episodes', async (req, res) => {
  try {
    const { session } = req.query;
    if (!session) {
      return res.status(400).json({ error: 'Query parameter "session" is required' });
    }
    const episodes = await pahe.getEpisodes(session);
    res.json(episodes);
  } catch (error) {
    console.error('Episodes error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

app.get('/latest', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const latest = await pahe.getLatest(page);
    res.json(latest);
  } catch (error) {
    console.error('Latest error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

app.get('/sources', async (req, res) => {
  try {
    const { anime_session, episode_session } = req.query;
    if (!anime_session || !episode_session) {
      return res.status(400).json({
        error: 'Query parameters "anime_session" and "episode_session" are required'
      });
    }
    const sources = await pahe.getSources(anime_session, episode_session);
    res.json(sources);
  } catch (error) {
    console.error('Sources error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

app.get('/ids', async (req, res) => {
  try {
    const { session } = req.query;
    if (!session) {
      return res.status(400).json({ error: 'Query parameter "session" is required' });
    }
    const ids = await pahe.getIds(session);
    res.json(ids);
  } catch (error) {
    console.error('IDs error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

app.get('/m3u8', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Query parameter "url" is required' });
    }
    const result = await pahe.resolveKwikWithNode(url);

    // Return m3u8 URL along with required referer for CORS bypass
    res.json({
      m3u8: result.m3u8,
      referer: result.referer,
      headers: {
        'Referer': result.referer,
        'Origin': result.origin
      },
      proxy_url: `/proxy?url=${encodeURIComponent(result.m3u8)}&referer=${encodeURIComponent(result.referer)}`
    });
  } catch (error) {
    console.error('M3U8 resolution error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

app.get('/proxy', async (req, res) => {
  try {
    const { url, referer: customReferer } = req.query;

    if (!url) {
      return res.status(400).json({
        error: 'Query parameter "url" is required'
      });
    }

    // Auto resolve Kwik links
    if (
      url.includes('kwik.cx/e/') ||
      url.includes('kwik.si/e/') ||
      url.match(/kwik\.[a-z]+\/e\//)
    ) {

      try {

        const result =
          await pahe.resolveKwikWithNode(url);

        return res.redirect(
          302,
          `/proxy?url=${encodeURIComponent(result.m3u8)}&referer=${encodeURIComponent(result.referer)}`
        );

      } catch (e) {

        console.error(e);

        return res.status(500).json({
          error: 'Failed to resolve Kwik URL'
        });
      }
    }

    const axios =
      require('axios');

    const urlObj =
      new URL(url);

    const referer =
      customReferer ||
      `${urlObj.protocol}//${urlObj.host}/`;

    const isKeyRequest =
      url.includes('.key');

    let response;

if (isKeyRequest) {

  response = await fetch(url, {

    headers: {

      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',

      'Referer':
        referer,

      'Sec-Fetch-Site':
        'same-site',

      'Accept-Encoding':
        'identity',
    }
  });

} else {

  response = await axios.get(url, {

    withCredentials: true,

    decompress: true,

    headers: {

      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',

      'Referer':
        referer,
      
      'Sec-Fetch-Site':
        'same-site',

      'Accept-Encoding':
        'identity',

      'Accept':
        '*/*',

      'Accept-Language':
        'en-US,en;q=0.9',

      'Cache-Control':
        'no-cache',

      'Pragma':
        'no-cache',

      ...(url.includes('.m3u8')
        ? {}
        : {
            'Range':
              req.headers.range || 'bytes=0-'
          }),
    },

    responseType:
      url.includes('.m3u8')
        ? 'text'
        : 'arraybuffer',

    timeout: 30000,

    maxRedirects: 5,

    validateStatus: status =>
      status >= 200 &&
      status < 500
  });
}

    if (isKeyRequest) {

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  res.setHeader(
    'Content-Type',
    'application/octet-stream'
  );

  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  return res.send(buffer);
}
    
    const contentType =
      response.headers['content-type'] ||
      (
        url.includes('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : url.includes('.ts')
          ? 'video/mp2t'
          : 'application/octet-stream'
      );

    // Handle playlists

    // Directly return playlists
// Rewrite playlists
if (
  contentType.includes('mpegurl') ||
  url.includes('.m3u8')
) {

  const content =
    String(response.data);

  const baseUrl =
    url.substring(
      0,
      url.lastIndexOf('/') + 1
    );

  const modified =
    content
      .split('\n')
      .map(line => {

        const t =
          line.trim();

        // Rewrite AES key URLs
        if (
          t.includes('URI="')
        ) {

          return t.replace(
            /URI="([^"]+)"/,
            (_, uri) => {

              const full =
                uri.startsWith('http')
                  ? uri
                  : baseUrl + uri;

              return `URI="https://${req.get('host')}/proxy?url=${encodeURIComponent(full)}&referer=${encodeURIComponent(customReferer || referer)}"`;
            }
          );
        }

        // Preserve HLS comments
        if (
          t.startsWith('#')
        ) {
          return line;
        }

        // Rewrite media segment URLs
        if (t) {

          const full =
            t.startsWith('http')
              ? t
              : baseUrl + t;

          return `https://${req.get('host')}/proxy?url=${encodeURIComponent(full)}&referer=${encodeURIComponent(customReferer || referer)}`;
        }

        return line;

      })
      .join('\n');

  res.setHeader(
    'Content-Type',
    'application/vnd.apple.mpegurl'
  );

  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  return res.send(modified);
}

      // Stream TS / KEY files
      res.setHeader(
        'Content-Type',
        contentType
      );

      res.setHeader(
        'Access-Control-Allow-Origin',
        '*'
      );

      res.setHeader(
        'Accept-Ranges',
        'bytes'
      );

      if (response.headers['content-length']) {
        res.setHeader(
          'Content-Length',
          response.headers['content-length']
        );
      }

      if (response.headers['content-range']) {
        res.setHeader(
          'Content-Range',
          response.headers['content-range']
        );
      }

      res.status(response.status);

  const buffer =
  Buffer.from(response.data);

res.end(buffer);

  } catch (error) {

    console.error(error);

    res.setHeader(
  'Cache-Control',
  'no-store, no-cache, must-revalidate, proxy-revalidate'
);

res.setHeader(
  'Pragma',
  'no-cache'
);

res.setHeader(
  'Expires',
  '0'
);

res.setHeader(
  'Surrogate-Control',
  'no-store'
);

    res.status(500).json({
      error: error.message
    });
  }
});

// Handle OPTIONS for CORS preflight
app.options('/proxy', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.sendStatus(200);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Export for Vercel
module.exports = app;

// Start server if not in Vercel environment
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Animepahe API server running on port ${PORT}`);
  });
  
}
