package jp.co.keai.niijimaig.support;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import jp.co.keai.niijimaig.image.application.CandidateImages;
import jp.co.keai.niijimaig.image.domain.ImageCandidate;
import jp.co.keai.niijimaig.post.application.InAttemptRetry;
import jp.co.keai.niijimaig.post.application.MediaStorage;
import jp.co.keai.niijimaig.post.application.RenderStorage;

/** 外部（Instagram・Storage）を差し替え、待ち時間をなくす */
@TestConfiguration(proxyBeanMethods = false)
public class FakeExternalsConfiguration {

	@Bean
	@Primary
	FakeInstagram fakeInstagram() {
		return new FakeInstagram();
	}

	@Bean
	@Primary
	MediaStorage fakeStorage() {
		return new MediaStorage() {
			@Override
			public String copyToPublic(UUID tenantId, String privatePath) {
				return tenantId + "/" + UUID.randomUUID() + ".jpg";
			}

			@Override
			public String publicUrl(String publicPath) {
				return "https://example.supabase.co/storage/v1/object/public/media-public/" + publicPath;
			}
		};
	}

	@Bean
	@Primary
	FakeCandidateStorage fakeCandidateStorage() {
		return new FakeCandidateStorage();
	}

	/** 消すよう頼まれた候補を覚えておく */
	public static class FakeCandidateStorage implements CandidateImages.Storage {
		public final List<ImageCandidate> deleted = new ArrayList<>();

		@Override
		public void delete(List<ImageCandidate> candidates) {
			deleted.addAll(candidates);
		}
	}

	@Bean
	@Primary
	FakeRenderStorage fakeRenderStorage() {
		return new FakeRenderStorage();
	}

	/** 非公開バケットの代わり。画像を置いておき、画像化した JPEG を覚える */
	public static class FakeRenderStorage implements RenderStorage {
		public final Map<String, byte[]> objects = new ConcurrentHashMap<>();

		@Override
		public Optional<byte[]> read(UUID tenantId, String privatePath) {
			return Optional.ofNullable(objects.get(privatePath));
		}

		@Override
		public void save(UUID tenantId, String privatePath, byte[] jpeg) {
			objects.put(privatePath, jpeg);
		}
	}

	@Bean
	@Primary
	InAttemptRetry.Sleeper noWait() {
		return duration -> { };
	}
}
