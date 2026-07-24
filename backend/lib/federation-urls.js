/**
 * Browser-facing direct URLs for remote media.
 * Remote images/videos are never mirrored — the viewer's browser loads them
 * straight from the peer's public federation endpoints (CORS-enabled there).
 */

/**
 * Build full/preview/thumb/detail URLs for a remote_images row joined with its
 * peer. `row` must carry remote_id and preview_path.
 */
function remoteMediaUrls(peerUrl, row) {
  const base = peerUrl ? peerUrl.replace(/\/+$/, '') : null;
  if (!base) {
    return { full_url: null, preview_url: null, thumb_url: null, detail_url: null };
  }
  return {
    full_url: `${base}/api/federation/media/${row.remote_id}/full`,
    preview_url: row.preview_path ? `${base}/api/federation/media/${row.remote_id}/preview` : null,
    thumb_url: `${base}/api/federation/image/${row.remote_id}/thumbnail`,
    detail_url: `${base}/api/federation/image/${row.remote_id}`,
  };
}

module.exports = { remoteMediaUrls };
