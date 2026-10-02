package jp.co.keai.niijimaig.shared.infrastructure;

import java.time.Clock;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import jp.co.keai.niijimaig.connection.infrastructure.TokenCipher;
import jp.co.keai.niijimaig.post.application.InAttemptRetry;

@Configuration
@EnableConfigurationProperties(NiijimaigProperties.class)
public class BatchConfiguration {

	@Bean
	Clock clock() {
		return Clock.systemUTC();
	}

	@Bean
	InAttemptRetry.Sleeper sleeper() {
		return duration -> {
			try {
				Thread.sleep(duration.toMillis());
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
		};
	}

	@Bean
	TokenCipher tokenCipher(NiijimaigProperties properties) {
		return new TokenCipher(properties.tokenKeyV1(), (short) 1);
	}
}
