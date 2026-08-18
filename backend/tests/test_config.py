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
