# 実装パターン：言語共通の考え方

| 概念（用語集の kind） | 守ること | Java/Kotlin | TypeScript | Python | Go | C# | PHP | Ruby |
|---|---|---|---|---|---|---|---|---|
| 値 value | 不変・生成時に検証・等価性は値で | final class / data class | class + readonly + private constructor + ファクトリ | `@dataclass(frozen=True)` + `__post_init__` | 非公開フィールドの struct + `NewX()` + 値レシーバ | `sealed record` / readonly struct | `final class` + `readonly` 昇格プロパティ | `attr_reader` + `freeze` |
| エンティティ entity/aggregate | 同一性で比較・業務の言葉のメソッドで状態変化 | 新インスタンスを返す（例外は ADR） | 同左 | `dataclasses.replace` | 値を返すメソッド | `with` 式 | `withX()` | 新インスタンス |
| コレクション collection | 生の配列を外に出さない・集計は自分で | `List.copyOf` で包む | `ReadonlyArray` を private に | `tuple` を包む | 非公開 slice + コピー | `IReadOnlyList` | 配列を private readonly に | `freeze` した配列 |
| 区分 kubun | 区分ごとの振る舞いを区分自身に | enum + 関数フィールド | `as const` オブジェクト + `satisfies` | `Enum` + メソッド | 型 + メソッド（`switch` はその中だけ） | スマート enum（record + static インスタンス） | backed enum + メソッド | 定数ハッシュ or クラス |
| 状態 state | 遷移可否を状態自身が判断 | enum + 遷移表 | 判別共用体 + 遷移関数 | `Enum` + 遷移表 | 型 + 遷移表 map | enum 拡張 or record | enum + `canTransitTo()` | 遷移表 |
| 仕様 rule | 名前の付いた判断を1か所に | `isSatisfiedBy` | 同左 | 同左 | 同左 | 同左 | 同左 | `satisfied_by?` |
| 未設定 | null を業務の意味に使わない | Optional / sealed | Result / 判別共用体 | 例外 or 専用型 | `(T, error)` + `ErrNotFound` | `Result<T>` / 専用型 | 専用型 / 例外 | Null Object |

## 共通の手順
1. 用語集の `invariants` をそのまま生成時の検証に写す（完全コンストラクタ P07）。
2. `behaviors` をメソッドにする。getter で値を返して外で計算しない（P12）。
3. 呼び出し側で同じ検証を書かない（P14）。
4. 表示用の値が必要なら「何に使うか」の名前のメソッド（`displayText()` 等）にする。
5. 永続化・シリアライズ用の変換は infrastructure / presentation 側に書く（P16）。

## 場合分けを単純にする（P26、2章）
```text
// Before: else と入れ子、複文
if (age < 13 && !member || coupon != null) { ... } else { if (...) { ... } }

// After: 判断をメソッドに独立させ、ガード節で早期リターン
Yen fee() {
    if (isChild()) return childFee();
    if (isSenior()) return seniorFee();
    return adultFee();
}
boolean isChild() { return age.isUnder(CHILD_AGE_LIMIT); }
```
区分ごとに fee() の中身が違うなら、さらに区分オブジェクト（区分ごとのクラスを同じ型として扱う / enum）へ移す（P09）。

## メソッドは必ずインスタンス変数を使う（P27、3章）
インスタンス変数を使わないメソッド（static な計算、他のオブジェクトの getter だけを使う計算）は、**そのデータを持つクラスに移す**。
例外はファクトリ（`of` / `from` / `create`）だけ。

## パッケージは業務の関心事で（P28、3章）
```text
domain/
  order/      Order, OrderLines, OrderLine, OrderStatus, OrderRepository
  customer/   Customer, CustomerNumber, EmailAddress
  shared/     Money, Quantity   ← 複数の関心事で使う値
```
`domain/dto`, `domain/entity`, `domain/util`, `domain/enums` のような技術種別で分けない。

## シナリオで組み立てる（P30、5章）
```text
// 小さなサービス（登録系・参照系に分ける）
StockQuery.isAvailable(productCode, quantity)
OrderRegistration.register(order)
OrderNotification.notifyAccepted(orderNumber)

// シナリオ：利用側の要求（「注文する」）を小さなサービスの組み合わせで実現
class PlaceOrderScenario {
    OrderNumber place(OrderRequest request) {
        Order order = request.toOrder();                  // 境界で値オブジェクトへ（P21）
        if (!stock.isAvailable(order.lines())) throw new OutOfStock(...);
        OrderNumber number = registration.register(order);
        notification.notifyAccepted(number);
        return number;
    }
}
```
- シナリオは手順だけ。業務ルールはドメインオブジェクト、データベース操作はリポジトリの実装に。
- 利用する側（コントローラー・画面・外部 API）と提供する側（シナリオ）の合意（入力・事前条件・結果・例外）を design.md に書く。

## リポジトリは業務の関心事の言葉で（P16、5章）
`findByStatusAndShippedAtIsNull()` ではなく `unshippedOrders()`。SQL / ORM の都合はリポジトリ実装（infrastructure）に閉じ込める。
