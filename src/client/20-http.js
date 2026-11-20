     * HTTP
     * ---------------------------------------------------------------------------------------- */

    function apiUrl(path, params) {
      const url = new URL(BASE + path, document.baseURI)
      if (params) {
        Object.keys(params).forEach(function (key) {
          const value = params[key]
          if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
        })
      }
      return url.toString()
    }

    function parseJsonResponse(response) {
      return response.text().then(function (text) {
        let body = null
        try {
          body = text ? JSON.parse(text) : null
        } catch (error) {
          body = null
        }
        if (!response.ok || body === null || body.ok === false) {
          const detail = body && body.error ? body.error : null
          const failure = new Error(
            (detail && detail.message) || 'design-canvas request failed (' + response.status + ')',
          )
          failure.code = detail && detail.code ? detail.code : 'http-' + response.status
          throw failure
        }
        return body
      })
    }

    function getState(sessionId) {
      return fetch(apiUrl('/state', { sessionId: sessionId }), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      }).then(parseJsonResponse)
    }

    function postOps(sessionId, ops, options) {
      const body = { sessionId: sessionId, ops: ops }
      if (options && options.atomic === true) body.atomic = true
      return fetch(apiUrl('/ops'), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(parseJsonResponse)
    }

