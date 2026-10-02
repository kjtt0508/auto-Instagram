package jp.co.keai.niijimaig;

import org.springframework.boot.SpringApplication;

public class TestNiijimaigBatchApplication {

	public static void main(String[] args) {
		SpringApplication.from(NiijimaigBatchApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
