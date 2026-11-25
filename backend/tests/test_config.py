from app.config import DEFAULT_CORS_ORIGINS, Settings


def test_cors_defaults_include_local_preview_ports() -> None:
    settings = Settings()

    assert "http://127.0.0.1:4191" in settings.normalized_cors_origins
    assert "http://localhost:4191" in settings.normalized_cors_origins


def test_cors_accepts_comma_separated_windows_env_style() -> None:
    settings = Settings(cors_origins="http://127.0.0.1:4191,http://localhost:4191")

    assert settings.normalized_cors_origins == [
        "http://127.0.0.1:4191",
        "http://localhost:4191",
    ]


def test_cors_blank_falls_back_to_defaults() -> None:
    settings = Settings(cors_origins=" ")

    assert settings.normalized_cors_origins == DEFAULT_CORS_ORIGINS


def test_custom_web_port_is_allowed_by_default(monkeypatch) -> None:
    monkeypatch.setenv("SPINVAULT_WEB_PORT", "4455")
    assert "http://127.0.0.1:4455" in Settings().normalized_cors_origins


def test_cors_allows_localhost_private_network_preflight(client) -> None:
    response = client.options(
        "/api/solvers",
        headers={
            "Origin": "http://127.0.0.1:4180",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Private-Network": "true",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:4180"
    assert response.headers["access-control-allow-private-network"] == "true"


def test_cors_allows_public_spinvault_domain(client) -> None:
    response = client.options(
        "/api/solvers",
        headers={
            "Origin": "https://spinvault.biz",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://spinvault.biz"


def test_private_network_rejects_untrusted_origin(client) -> None:
    response = client.options("/api/solvers", headers={
        "Origin": "https://untrusted.example",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
    })
    assert response.status_code == 400
    assert "access-control-allow-private-network" not in response.headers


def test_private_network_rejects_null_origin(client) -> None:
    response = client.options("/api/solvers", headers={
        "Origin": "null", "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
    })
    assert response.status_code == 400
    assert "access-control-allow-private-network" not in response.headers


def test_configured_origin_override_is_used(monkeypatch) -> None:
    from fastapi.testclient import TestClient
    from app.config import get_settings
    from app.main import create_app
    monkeypatch.setenv("SPINVAULT_CORS_ORIGINS", "https://example.test")
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as client:
            headers = {"Access-Control-Request-Method": "GET",
                       "Access-Control-Request-Private-Network": "true"}
            allowed = client.options("/api/solvers", headers={**headers, "Origin": "https://example.test"})
            denied = client.options("/api/solvers", headers={**headers, "Origin": "http://127.0.0.1:4180"})
            assert allowed.status_code == 200
            assert allowed.headers["access-control-allow-private-network"] == "true"
            assert denied.status_code == 400
            assert "access-control-allow-private-network" not in denied.headers
    finally:
        get_settings.cache_clear()
