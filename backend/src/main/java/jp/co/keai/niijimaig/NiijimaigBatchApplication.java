package jp.co.keai.niijimaig;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** 新島info Instagram自動投稿の定期処理。終了コードは BatchCommand が決める */
@SpringBootApplication
public class NiijimaigBatchApplication {

	public static void main(String[] args) {
		System.exit(SpringApplication.exit(SpringApplication.run(NiijimaigBatchApplication.class, args)));
	}

}
