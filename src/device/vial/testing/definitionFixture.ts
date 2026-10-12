// テスト用のレイアウト定義。2 行 3 列、エンコーダー 1 つ。python の lzma.compress（XZ 形式）で圧縮したもの
export const definitionJson = {
  "name": "テスト用の機器",
  "matrix": {
    "rows": 2,
    "cols": 3
  },
  "layouts": {
    "keymap": [
      [
        "0,0",
        "0,1",
        {
          "w": 1.5
        },
        "0,2",
        "0,0\n\n\n\n\n\n\n\n\ne",
        "0,1\n\n\n\n\n\n\n\n\ne"
      ],
      [
        {
          "x": 0.25
        },
        "1,0",
        "1,1",
        "1,2"
      ]
    ]
  }
}

export const compressedDefinitionHex =
  'fd377a585a000004e6d6b4460200210116000000742fe5a3e000c2008c5d003d8889c65436c3174fe5354c073bf437f0e9cd470341a4a989e1e6bb17cd03e3d7adf3e8863db6385700cc7d26ab9c90519fca20778b813c7baad0789a76daed33a3fed40c1019aa5e4d7f07a1b6fc069bafb9bf17b50c019c6b59a38e497bc3bd4d15d7160c1b8455caa7836b3374483b5b94f2eca1028f859cc5e3a9c9eddccbfc29c95a1c55d57f81170000ca31e891fc2895860001a801c30100003145406eb1c467fb020000000004595a'
