import LeagueControlledBestSixScreen from "./LeagueControlledBestSixScreen";

type Props = {
  variant?: "home" | "explore";
};

/** @deprecated use LeagueControlledBestSixScreen with league="WNBA" */
export default function WnbaControlledBestSixScreen({ variant = "explore" }: Props) {
  return <LeagueControlledBestSixScreen league="WNBA" variant={variant} />;
}
