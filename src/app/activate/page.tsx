import { ActivateForm } from "@/components/activate-form"

type ActivatePageProps = {
  searchParams: Promise<{ token?: string }>
}

export default async function ActivatePage({
  searchParams,
}: ActivatePageProps) {
  const { token = "" } = await searchParams

  return <ActivateForm token={token} />
}
