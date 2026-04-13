import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<SymbolViewProps["name"], ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

const MAPPING = {
  "house.fill": "home",
  "bolt.fill": "flash-on",
  "clock.fill": "history",
  "paperplane.fill": "rocket-launch",
  "gearshape.fill": "settings",
  "chevron.right": "chevron-right",
  "chevron.left": "chevron-left",
  "xmark": "close",
  "checkmark": "check",
  "play.fill": "play-arrow",
  "stop.fill": "stop",
  "pause.fill": "pause",
  "arrow.up": "arrow-upward",
  "arrow.down": "arrow-downward",
  "exclamationmark.triangle.fill": "warning",
  "info.circle.fill": "info",
  "doc.fill": "description",
  "wallet.pass.fill": "account-balance-wallet",
  "chart.line.uptrend.xyaxis": "show-chart",
  "flame.fill": "local-fire-department",
  "shield.fill": "security",
  "eye.fill": "visibility",
  "eye.slash.fill": "visibility-off",
  "plus": "add",
  "trash.fill": "delete",
  "arrow.clockwise": "refresh",
  "network": "hub",
  "cpu": "memory",
  "lock.fill": "lock",
  "key.fill": "vpn-key",
  "dollarsign.circle.fill": "monetization-on",
  "waveform": "graphic-eq",
  "antenna.radiowaves.left.and.right": "wifi",
} as IconMapping;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
