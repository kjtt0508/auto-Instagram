package com.example.architecture;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.*;
import static com.tngtech.archunit.library.Architectures.layeredArchitecture;

/**
 * [任意アダプタ] ハーネスの依存方向チェック（正規表現ベース）を、バイトコード解析で厳密に補強する。
 * 配置: src/test/java/<base>/architecture/ 。@AnalyzeClasses の packages を base package に置換。
 * 依存: com.tngtech.archunit:archunit-junit5（test スコープ）
 */
@AnalyzeClasses(packages = "com.example", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

    // P16 依存の向きは外側 → ドメイン
    @ArchTest
    static final ArchRule layers = layeredArchitecture().consideringOnlyDependenciesInLayers()
            .layer("Presentation").definedBy("..presentation..")
            .layer("Application").definedBy("..application..")
            .layer("Domain").definedBy("..domain..")
            .layer("Infrastructure").definedBy("..infrastructure..")
            .whereLayer("Presentation").mayNotBeAccessedByAnyLayer()
            .whereLayer("Application").mayOnlyBeAccessedByLayers("Presentation", "Infrastructure")   // harness.yaml の allowed と揃える
            .whereLayer("Infrastructure").mayNotBeAccessedByAnyLayer()
            .whereLayer("Domain").mayOnlyBeAccessedByLayers("Application", "Presentation", "Infrastructure");

    // P16 ドメインを技術的関心事から独立させる
    @ArchTest
    static final ArchRule domain_is_framework_free = noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAnyPackage(
                    "org.springframework..", "jakarta.persistence..", "javax.persistence..",
                    "com.fasterxml.jackson..", "jakarta.servlet..")
            .because("P16: 画面・DB・通信の都合をドメインに持ち込まない");

    // P12 setter を作らない
    @ArchTest
    static final ArchRule no_setters_in_domain = noMethods().that().areDeclaredInClassesThat().resideInAPackage("..domain..")
            .should().haveNameMatching("set[A-Z].*")
            .because("P12: 変更は業務の言葉のメソッドで表現する");

    // P06 / P12 フィールドは private final
    @ArchTest
    static final ArchRule domain_fields_private = fields().that().areDeclaredInClassesThat().resideInAPackage("..domain..")
            .and().areNotStatic()
            .should().bePrivate()
            .because("P12: 内部状態を公開しない");

    // 可変が必要なクラスは ADR を書き、下の除外リストに追加する（harness-allow-file: P06 と揃える）
    @ArchTest
    static final ArchRule domain_fields_final = fields().that().areDeclaredInClassesThat().resideInAPackage("..domain..")
            .and().areNotStatic()
            .and().areDeclaredInClassesThat().areNotEnums()
            .should().beFinal()
            .because("P06: 値は不変");

    // P15 コントローラーはリポジトリを直接使わない
    @ArchTest
    static final ArchRule controllers_use_application = noClasses().that().resideInAPackage("..presentation..")
            .should().dependOnClassesThat().haveSimpleNameEndingWith("Repository")
            .because("P15: ユースケースはアプリケーションサービスが調整する");

    // P07 完全コンストラクタ：フィールドインジェクション禁止
    @ArchTest
    static final ArchRule no_field_injection = noFields()
            .should().beAnnotatedWith("org.springframework.beans.factory.annotation.Autowired")
            .because("P07: 依存はコンストラクタで受け取る");

    // P01 曖昧な名前を避ける
    @ArchTest
    static final ArchRule no_vague_names = noClasses()
            .should().haveSimpleNameEndingWith("Manager").orShould().haveSimpleNameEndingWith("Util")
            .orShould().haveSimpleNameEndingWith("Utils").orShould().haveSimpleNameEndingWith("Helper")
            .orShould().haveSimpleNameEndingWith("Info").orShould().haveSimpleNameEndingWith("Data")
            .because("P01: 業務の言葉で名前を付ける");
}
