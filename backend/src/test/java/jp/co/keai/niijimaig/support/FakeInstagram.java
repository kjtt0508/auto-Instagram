package jp.co.keai.niijimaig.support;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import jp.co.keai.niijimaig.connection.application.InstagramTokenRefresher;
import jp.co.keai.niijimaig.connection.domain.InstagramConnection;
import jp.co.keai.niijimaig.post.application.InstagramApiException;
import jp.co.keai.niijimaig.post.application.InstagramPublisher;
import jp.co.keai.niijimaig.post.domain.Caption;
import jp.co.keai.niijimaig.post.domain.FailureKind;
import jp.co.keai.niijimaig.post.domain.PublishResult;

/** テスト用の Instagram。呼ばれた回数を数え、失敗や状態を差し込める */
public class FakeInstagram implements InstagramPublisher, InstagramTokenRefresher {

	public boolean quotaAvailable = true;
	public final Deque<FailureKind> containerFailures = new ArrayDeque<>();
	public final Map<String, ContainerState> states = new HashMap<>();
	public final List<String> publishedCaptions = new ArrayList<>();
	public final AtomicInteger publishCalls = new AtomicInteger();
	public final AtomicInteger containerCalls = new AtomicInteger();
	public Optional<FailureKind> refreshFailure = Optional.empty();
	private final AtomicInteger ids = new AtomicInteger();

	public void reset() {
		quotaAvailable = true;
		containerFailures.clear();
		states.clear();
		publishedCaptions.clear();
		publishCalls.set(0);
		containerCalls.set(0);
		refreshFailure = Optional.empty();
	}

	@Override
	public boolean hasPublishingQuota(InstagramConnection connection) {
		return quotaAvailable;
	}

	@Override
	public String createImageContainer(InstagramConnection connection, String imageUrl, Caption caption) {
		return container(caption.text());
	}

	@Override
	public String createCarouselItem(InstagramConnection connection, String imageUrl) {
		return container("");
	}

	@Override
	public String createCarouselContainer(InstagramConnection connection, List<String> childIds, Caption caption) {
		return container(caption.text());
	}

	private String container(String caption) {
		containerCalls.incrementAndGet();
		FailureKind failure = containerFailures.poll();
		if (failure != null) {
			throw new InstagramApiException(failure, "fake " + failure);
		}
		String id = "c" + ids.incrementAndGet();
		states.put(id, ContainerState.FINISHED);
		captions.put(id, caption);
		return id;
	}

	private final Map<String, String> captions = new HashMap<>();

	@Override
	public ContainerState containerState(InstagramConnection connection, String containerId) {
		return states.getOrDefault(containerId, ContainerState.EXPIRED);
	}

	@Override
	public String publish(InstagramConnection connection, String containerId) {
		publishCalls.incrementAndGet();
		states.put(containerId, ContainerState.PUBLISHED);
		publishedCaptions.add(captions.getOrDefault(containerId, ""));
		return "m-" + containerId;
	}

	@Override
	public PublishResult describe(InstagramConnection connection, String mediaId) {
		return new PublishResult(mediaId, "https://www.instagram.com/p/" + mediaId, Instant.now());
	}

	@Override
	public Optional<String> findPublishedMedia(InstagramConnection connection, Caption caption, Instant since) {
		return publishedCaptions.contains(caption.text()) ? Optional.of("m-recovered") : Optional.empty();
	}

	@Override
	public InstagramConnection refresh(InstagramConnection connection) {
		if (refreshFailure.isPresent()) {
			throw new InstagramApiException(refreshFailure.get(), "fake refresh failure");
		}
		return connection.refreshedWith(connection.token(),
				new jp.co.keai.niijimaig.connection.domain.TokenExpiry(Instant.now().plusSeconds(60L * 60 * 24 * 60)));
	}
}
