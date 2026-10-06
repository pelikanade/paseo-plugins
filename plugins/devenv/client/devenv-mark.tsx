import { View } from "react-native";

export const devenvBrandBlue = "#425C82";

const squares = [
  { column: 2, row: 0, tint: false },
  { column: 2, row: 1, tint: false },
  { column: 3, row: 1, tint: false },
  { column: 1, row: 1, tint: true },
  { column: 0, row: 2, tint: true },
  { column: 1, row: 2, tint: true },
  { column: 2, row: 2, tint: true },
  { column: 3, row: 2, tint: false },
] as const;

const markUnits = 35;
const markHeightUnits = 26;
const cellUnits = 8;
const pitchUnits = 9;

export const devenvMarkHeightRatio = markHeightUnits / markUnits;

export function DevenvMark({ size, color }: { size: number; color: string }) {
  const unit = size / markUnits;
  const cell = unit * cellUnits;
  const pitch = unit * pitchUnits;
  return (
    <View style={{ width: size, height: size * devenvMarkHeightRatio }}>
      {squares.map((square) => (
        <View
          key={square.column * 4 + square.row}
          style={{
            position: "absolute",
            left: square.column * pitch,
            top: square.row * pitch,
            width: cell,
            height: cell,
            backgroundColor: square.tint ? color : devenvBrandBlue,
          }}
        />
      ))}
    </View>
  );
}
