import { compressedDefinitionHex } from './definitionFixture.ts'
import type { SimulatedState } from './simulatedKeyboard.ts'

const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))

/** 3 レイヤー、2 行 3 列、エンコーダー 1 つ、Tap Dance 2 枠、Combo 1 枠の本体 */
export function sampleState(): SimulatedState {
  return {
    viaProtocol: 9,
    vialProtocol: 6,
    uid: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef],
    compressedDefinition: fromHex(compressedDefinitionHex),
    rows: 2,
    cols: 3,
    // 1 レイヤーが 12 バイトなので、3 レイヤーで 36 バイト。28 バイトずつの読み出しが2回に分かれる
    keymap: [
      [0x0004, 0x0005, 0x0006, 0x0007, 0x0008, 0x5700],
      [0x0001, 0x0001, 0x5220, 0x4129, 0x2204, 0x0000],
      [0x001e, 0x001f, 0x0020, 0x0021, 0x0022, 0x7e40],
    ],
    encoders: [[[0x0081, 0x0080]], [[0x0050, 0x004f]], [[0x0001, 0x0001]]],
    tapDances: [
      { onTap: 0x0004, onHold: 0x00e0, onDoubleTap: 0x0029, onTapHold: 0x5221, tappingTerm: 200 },
      { onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 200 },
    ],
    combos: [{ keys: [0x0004, 0x0005, 0, 0], output: 0x0029 }],
  }
}
