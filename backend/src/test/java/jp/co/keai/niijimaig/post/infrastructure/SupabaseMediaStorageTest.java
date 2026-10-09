package jp.co.keai.niijimaig.post.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.sun.net.httpserver.HttpServer;

import jp.co.keai.niijimaig.shared.infrastructure.NiijimaigProperties;

/** Supabase Storage への複製（公開用の名前の決め方と、複製済みの扱い）を、偽の HTTP サーバーで確かめる（REQ-002 設計 6章） */
class SupabaseMediaStorageTest {

	HttpServer server;
	final AtomicInteger status = new AtomicInteger(200);
	volatile String responseBody = "{}";
	final List<String> requestBodies = new CopyOnWriteArrayList<>();
	UUID tenant = UUID.randomUUID();
	String privatePath;

	@BeforeEach
	void startServer() throws IOException {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/", exchange -> {
			requestBodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
			byte[] body = responseBody.getBytes(StandardCharsets.UTF_8);
			exchange.sendResponseHeaders(status.get(), body.length);
			exchange.getResponseBody().write(body);
			exchange.close();
		});
		server.start();
		privatePath = tenant + "/renders/1/1.jpg";
	}

	@AfterEach
	void stopServer() {
		server.stop(0);
	}

	private SupabaseMediaStorage storage(String serviceRoleKey) {
		return new SupabaseMediaStorage(new NiijimaigProperties("http://127.0.0.1:" + server.getAddress().getPort(), serviceRoleKey, null, null, null));
	}

	@Test
	@DisplayName("AC-002-23 同じ鍵なら同じ公開用の名前になる。団体・鍵・サービスのキーが違えば別の名前になる")
	void sameKeyGivesSameName() {
		SupabaseMediaStorage storage = storage("key-1");

		String first = storage.copyToPublic(tenant, privatePath, "render/77/1");
		String again = storage.copyToPublic(tenant, privatePath, "render/77/1");

		assertThat(again).isEqualTo(first);
		assertThat(first).startsWith(tenant + "/").endsWith(".jpg").matches(".*/[0-9a-f]{64}\\.jpg");
		assertThat(storage.copyToPublic(tenant, privatePath, "render/77/2")).isNotEqualTo(first);
		assertThat(storage("key-2").copyToPublic(tenant, privatePath, "render/77/1")).isNotEqualTo(first);
		assertThat(storage.copyToPublic(tenant, privatePath, "render/77/1")).doesNotContain("key-1").doesNotContain("render");
	}

	@Test
	@DisplayName("AC-002-23 複製先が既にある（HTTP 409、または本文に Duplicate を含む 400）は成功として扱う")
	void duplicateIsSuccess() {
		SupabaseMediaStorage storage = storage("key-1");
		status.set(409);
		String viaConflict = storage.copyToPublic(tenant, privatePath, "render/77/1");

		status.set(400);
		responseBody = "{\"error\":\"Duplicate\",\"message\":\"The resource already exists\"}";
		String viaDuplicate = storage.copyToPublic(tenant, privatePath, "render/77/1");

		assertThat(viaDuplicate).isEqualTo(viaConflict);
	}

	@Test
	@DisplayName("AC-002-23 Duplicate を含まない 400 と 5xx は失敗にする")
	void otherErrorsFail() {
		SupabaseMediaStorage storage = storage("key-1");
		status.set(400);
		responseBody = "{\"error\":\"InvalidKey\"}";
		assertThatThrownBy(() -> storage.copyToPublic(tenant, privatePath, "render/77/1")).hasMessageContaining("HTTP 400");

		status.set(503);
		assertThatThrownBy(() -> storage.copyToPublic(tenant, privatePath, "render/77/1")).hasMessageContaining("HTTP 503");
	}

	@Test
	@DisplayName("AC-002-23 鍵のない複製（写真の投稿）は、409 を成功にしない")
	void conflictIsAnErrorWithoutAKey() {
		status.set(409);

		assertThatThrownBy(() -> storage("key-1").copyToPublic(tenant, privatePath)).hasMessageContaining("HTTP 409");
	}

	@Test
	@DisplayName("AC-002-23 他の団体の保存先は複製しない")
	void otherTenantPathIsRejected() {
		assertThatThrownBy(() -> storage("key-1").copyToPublic(tenant, UUID.randomUUID() + "/renders/1/1.jpg", "render/77/1"))
				.isInstanceOf(RuntimeException.class);
		assertThat(requestBodies).isEmpty();
	}
}
