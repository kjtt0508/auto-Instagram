package jp.co.keai.niijimaig.post.infrastructure;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import jp.co.keai.niijimaig.connection.application.InstagramTokenRefresher;
import jp.co.keai.niijimaig.connection.domain.AccessToken;
import jp.co.keai.niijimaig.connection.domain.InstagramConnection;
import jp.co.keai.niijimaig.connection.domain.TokenExpiry;
import jp.co.keai.niijimaig.post.application.InstagramApiException;
import jp.co.keai.niijimaig.post.application.InstagramPublisher;
import jp.co.keai.niijimaig.post.domain.AiDisclosure;
import jp.co.keai.niijimaig.post.domain.Caption;
import jp.co.keai.niijimaig.post.domain.FailureKind;
import jp.co.keai.niijimaig.post.domain.PublishResult;
import jp.co.keai.niijimaig.shared.infrastructure.NiijimaigProperties;

/**
 * Instagram Graph API（Instagram ログイン方式）の薄いクライアント（02_外部連携設計 1章）。
 * アクセストークンを含む URL・応答本文はログに出さない。
 */
@Component
public class GraphInstagramClient implements InstagramPublisher, InstagramTokenRefresher {

	static final DateTimeFormatter IG_TIMESTAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssZ");
	static final Duration TIMEOUT = Duration.ofSeconds(30);

	private final HttpClient http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();
	private final JsonMapper json = JsonMapper.builder().build();
	private final InstagramErrorClassifier classifier = new InstagramErrorClassifier();
	private final String graphBase;
	private final String refreshEndpoint;

	public GraphInstagramClient(NiijimaigProperties properties) {
		this.graphBase = properties.instagramGraphBase() + "/" + properties.igApiVersion();
		this.refreshEndpoint = properties.instagramGraphBase() + "/refresh_access_token";
	}

	@Override
	public boolean hasPublishingQuota(InstagramConnection c) {
		JsonNode limit = get(c, "/" + c.igUserId() + "/content_publishing_limit", Map.of("fields", "quota_usage,config"))
				.path("data").path(0);
		return limit.path("quota_usage").asInt(0) < limit.path("config").path("quota_total").asInt(Integer.MAX_VALUE);
	}

	@Override
	public String createImageContainer(InstagramConnection c, String imageUrl, Caption caption, AiDisclosure disclosure) {
		return post(c, "/" + c.igUserId() + "/media",
				withAiInfo(Map.of("image_url", imageUrl, "caption", caption.text()), disclosure)).path("id").asString();
	}

	@Override
	public String createCarouselItem(InstagramConnection c, String imageUrl) {
		return post(c, "/" + c.igUserId() + "/media", Map.of("image_url", imageUrl, "is_carousel_item", "true"))
				.path("id").asString();
	}

	@Override
	public String createCarouselContainer(InstagramConnection c, List<String> childIds, Caption caption, AiDisclosure disclosure) {
		return post(c, "/" + c.igUserId() + "/media", withAiInfo(Map.of("media_type", "CAROUSEL",
				"children", String.join(",", childIds), "caption", caption.text()), disclosure)).path("id").asString();
	}

	/** AI生成の表示が要るなら AI info（is_ai_generated=true）を足す（02_外部連携設計 1.3、REQ-005 BR-005-05） */
	private Map<String, String> withAiInfo(Map<String, String> params, AiDisclosure disclosure) {
		if (!disclosure.isRequired()) {
			return params;
		}
		Map<String, String> withInfo = new LinkedHashMap<>(params);
		withInfo.put("is_ai_generated", "true");
		return withInfo;
	}

	@Override
	public ContainerState containerState(InstagramConnection c, String containerId) {
		String code = get(c, "/" + containerId, Map.of("fields", "status_code")).path("status_code").asString();
		return ContainerState.valueOf(code);
	}

	@Override
	public String publish(InstagramConnection c, String containerId) {
		return post(c, "/" + c.igUserId() + "/media_publish", Map.of("creation_id", containerId)).path("id").asString();
	}

	@Override
	public PublishResult describe(InstagramConnection c, String mediaId) {
		JsonNode media = get(c, "/" + mediaId, Map.of("fields", "permalink,timestamp"));
		return new PublishResult(mediaId, media.path("permalink").asString(), timestampOf(media));
	}

	@Override
	public Optional<String> findPublishedMedia(InstagramConnection c, Caption caption, Instant since) {
		JsonNode recent = get(c, "/" + c.igUserId() + "/media", Map.of("fields", "id,caption,timestamp", "limit", "10"));
		return StreamSupport.stream(recent.path("data").spliterator(), false)
				.filter(m -> caption.text().equals(m.path("caption").asString()))
				.filter(m -> !timestampOf(m).isBefore(since.minus(Duration.ofMinutes(1))))
				.map(m -> m.path("id").asString())
				.findFirst();
	}

	@Override
	public InstagramConnection refresh(InstagramConnection c) {
		JsonNode body = send(HttpRequest.newBuilder(URI.create(refreshEndpoint + "?"
				+ form(Map.of("grant_type", "ig_refresh_token", "access_token", c.token().reveal())))).GET());
		Instant expiresAt = Instant.now().plusSeconds(body.path("expires_in").asLong());
		return c.refreshedWith(new AccessToken(body.path("access_token").asString()), new TokenExpiry(expiresAt));
	}

	private Instant timestampOf(JsonNode media) {
		return OffsetDateTime.parse(media.path("timestamp").asString(), IG_TIMESTAMP).toInstant();
	}

	private JsonNode get(InstagramConnection c, String path, Map<String, String> params) {
		Map<String, String> query = new LinkedHashMap<>(params);
		query.put("access_token", c.token().reveal());
		return send(HttpRequest.newBuilder(URI.create(graphBase + path + "?" + form(query))).GET());
	}

	private JsonNode post(InstagramConnection c, String path, Map<String, String> params) {
		Map<String, String> body = new LinkedHashMap<>(params);
		body.put("access_token", c.token().reveal());
		return send(HttpRequest.newBuilder(URI.create(graphBase + path))
				.header("Content-Type", "application/x-www-form-urlencoded")
				.POST(HttpRequest.BodyPublishers.ofString(form(body))));
	}

	private JsonNode send(HttpRequest.Builder request) {
		try {
			HttpResponse<String> response = http.send(request.timeout(TIMEOUT).build(), HttpResponse.BodyHandlers.ofString());
			JsonNode body = json.readTree(response.body());
			if (response.statusCode() >= 400 || body.has("error")) {
				FailureKind kind = classifier.classify(response.statusCode(), body);
				throw new InstagramApiException(kind, "Instagram API " + response.statusCode() + " "
						+ body.path("error").path("code").asInt(-1));
			}
			return body;
		} catch (IOException e) {
			throw new InstagramApiException(FailureKind.TRANSIENT, "Instagram API に接続できない: " + e.getClass().getSimpleName());
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new InstagramApiException(FailureKind.TRANSIENT, "中断された");
		}
	}

	private String form(Map<String, String> params) {
		return params.entrySet().stream()
				.map(e -> e.getKey() + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
				.collect(Collectors.joining("&"));
	}
}
