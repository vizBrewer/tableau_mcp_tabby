"""
Mint Tableau Connected App (direct-trust) JWTs for embedding.

Tableau's Embedding API v3 authenticates a `<tableau-viz>` / `<tableau-authoring-viz>`
with an HS256 JWT signed by a Connected App secret. See:
https://help.tableau.com/current/online/en-us/connected_apps_direct.htm
"""

import time
import uuid

import jwt  # PyJWT

# Tableau rejects tokens whose exp is more than 10 minutes in the future.
MAX_TOKEN_LIFETIME_SECONDS = 600
# Small backdate on iat to absorb clock skew between this host and Tableau.
CLOCK_SKEW_SECONDS = 5


def mint_embed_token(signing: dict) -> tuple[str, int]:
    """
    Mint an HS256 connected-app JWT.

    Args:
        signing: dict from settings_store.get_signing_material() with keys
            client_id, secret_id, secret_value, embedding_username, scopes,
            token_lifetime_seconds.

    Returns:
        (token, exp_epoch)
    """
    client_id = signing["client_id"]
    secret_id = signing["secret_id"]
    secret_value = signing["secret_value"]
    username = signing["embedding_username"]
    scopes = signing.get("scopes") or ["tableau:views:embed"]
    lifetime = min(
        int(signing.get("token_lifetime_seconds", MAX_TOKEN_LIFETIME_SECONDS)),
        MAX_TOKEN_LIFETIME_SECONDS,
    )

    now = int(time.time())
    exp = now + lifetime

    headers = {
        "alg": "HS256",
        "typ": "JWT",
        "kid": secret_id,
        "iss": client_id,
    }
    payload = {
        "iss": client_id,
        "aud": "tableau",
        "sub": username,
        "jti": str(uuid.uuid4()),
        "scp": scopes,
        "iat": now - CLOCK_SKEW_SECONDS,
        "exp": exp,
    }

    token = jwt.encode(payload, secret_value, algorithm="HS256", headers=headers)
    # PyJWT >= 2 returns str; older returns bytes.
    if isinstance(token, bytes):
        token = token.decode("utf-8")
    return token, exp
