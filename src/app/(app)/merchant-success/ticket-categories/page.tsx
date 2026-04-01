"use client"

import * as React from "react"

import { getSessionUser } from "@/lib/session"
import { ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/toast-provider"

type CategoryNode = {
  id: string
  name: string
  sortOrder: number
  subcategories: CategoryNode[]
}

export default function TicketCategoriesPage() {
  const [categories, setCategories] = React.useState<CategoryNode[]>([])
  const [loading, setLoading] = React.useState(true)
  const { showToast } = useToast()
  const [categoryName, setCategoryName] = React.useState("")
  const [subcategoryName, setSubcategoryName] = React.useState("")
  const [subcategoryParentId, setSubcategoryParentId] = React.useState<
    string | null
  >(null)
  const [subcategory2Name, setSubcategory2Name] = React.useState("")
  const [subcategory2CategoryId, setSubcategory2CategoryId] = React.useState<
    string | null
  >(null)
  const [subcategory2ParentId, setSubcategory2ParentId] = React.useState<
    string | null
  >(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingName, setEditingName] = React.useState("")
  const [expandedIds, setExpandedIds] = React.useState<Record<string, boolean>>(
    {}
  )

  const loadCategories = React.useCallback(async () => {
    const user = getSessionUser()
    if (!user?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const response = await fetch("/api/ticket-categories")
      if (!response.ok) {
        throw new Error("Unable to load categories.")
      }
      const data = (await response.json()) as { categories: CategoryNode[] }
      setCategories(data.categories ?? [])
    } catch (error) {
      console.error(error)
      showToast("Unable to load categories.", "error")
    } finally {
      setLoading(false)
    }
  }, [showToast])

  React.useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  const handleCreateCategory = async () => {
    const user = getSessionUser()
    if (!user?.id || !categoryName.trim()) {
      return
    }
    try {
      const response = await fetch("/api/ticket-categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: categoryName }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error ?? "Unable to create category.")
      }
      setCategoryName("")
      await loadCategories()
      showToast("Category added.")
    } catch (error) {
      console.error(error)
      showToast(
        error instanceof Error ? error.message : "Unable to create category.",
        "error"
      )
    }
  }

  const handleCreateSubcategory = async () => {
    const user = getSessionUser()
    if (!user?.id || !subcategoryName.trim() || !subcategoryParentId) {
      return
    }
    try {
      const response = await fetch("/api/ticket-categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: subcategoryName,
          parentId: subcategoryParentId,
        }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error ?? "Unable to create subcategory.")
      }
      setSubcategoryName("")
      await loadCategories()
      showToast("Subcategory added.")
    } catch (error) {
      console.error(error)
      showToast(
        error instanceof Error ? error.message : "Unable to create subcategory.",
        "error"
      )
    }
  }

  const handleCreateSubcategory2 = async () => {
    const user = getSessionUser()
    if (
      !user?.id ||
      !subcategory2Name.trim() ||
      !subcategory2CategoryId ||
      !subcategory2ParentId
    ) {
      return
    }
    try {
      const response = await fetch("/api/ticket-categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: subcategory2Name,
          parentId: subcategory2ParentId,
        }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error ?? "Unable to create subcategory.")
      }
      setSubcategory2Name("")
      await loadCategories()
      showToast("Subcategory 2 added.")
    } catch (error) {
      console.error(error)
      showToast(
        error instanceof Error ? error.message : "Unable to create subcategory.",
        "error"
      )
    }
  }

  const handleRename = async (categoryId: string) => {
    const user = getSessionUser()
    if (!user?.id || !editingName.trim()) {
      return
    }
    try {
      const response = await fetch("/api/ticket-categories", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: categoryId, name: editingName }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error ?? "Unable to update category.")
      }
      setEditingId(null)
      setEditingName("")
      await loadCategories()
      showToast("Category updated.")
    } catch (error) {
      console.error(error)
      showToast(
        error instanceof Error ? error.message : "Unable to update category.",
        "error"
      )
    }
  }

  const handleDelete = async (categoryId: string) => {
    const user = getSessionUser()
    if (!user?.id) {
      return
    }
    const confirmDelete = window.confirm(
      "Delete this category and all subcategories?"
    )
    if (!confirmDelete) {
      return
    }
    try {
      const response = await fetch(
        `/api/ticket-categories?id=${encodeURIComponent(categoryId)}`,
        {
          method: "DELETE",
        }
      )
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error ?? "Unable to delete category.")
      }
      await loadCategories()
      showToast("Category deleted.")
    } catch (error) {
      console.error(error)
      showToast(
        error instanceof Error ? error.message : "Unable to delete category.",
        "error"
      )
    }
  }

  const renderCategory = (category: CategoryNode, depth = 0) => {
    const isEditing = editingId === category.id
    const hasChildren = category.subcategories.length > 0
    const isExpanded = expandedIds[category.id] ?? false

    const content = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-[200px] items-start gap-2">
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="mt-0.5 inline-flex size-6 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                aria-label={
                  isExpanded ? "Collapse category" : "Expand category"
                }
              >
                <ChevronRight
                  className={[
                    "size-4 transition-transform",
                    isExpanded ? "rotate-90" : "",
                  ].join(" ")}
                />
              </button>
            </CollapsibleTrigger>
          ) : (
            <span className="mt-0.5 inline-flex size-6" />
          )}
          <div className="min-w-[160px]">
            {isEditing ? (
              <Input
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
              />
            ) : (
              <div className="text-sm font-semibold">
                {depth === 0
                  ? category.name
                  : `${"-".repeat(depth)} ${category.name}`}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button size="sm" onClick={() => handleRename(category.id)}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingId(null)
                  setEditingName("")
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingId(category.id)
                  setEditingName(category.name)
                }}
              >
                Rename
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(category.id)}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
    )

    if (!hasChildren) {
      return (
        <div
          key={category.id}
          className="rounded-lg border border-border/60 px-4 py-3"
        >
          {content}
        </div>
      )
    }

    return (
      <Collapsible
        key={category.id}
        open={isExpanded}
        onOpenChange={(open) =>
          setExpandedIds((current) => ({ ...current, [category.id]: open }))
        }
      >
        <div className="rounded-lg border border-border/60 px-4 py-3">
          {content}
          <CollapsibleContent>
            <div className="mt-3 grid gap-2">
              {category.subcategories.map((subcategory) =>
                renderCategory(subcategory, depth + 1)
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    )
  }

  const subcategoryParentOptions = categories
  const subcategory2Category = categories.find(
    (category) => category.id === subcategory2CategoryId
  )
  const subcategory2ParentOptions = subcategory2Category?.subcategories ?? []

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Ticket Categories
        </h1>
        <p className="text-muted-foreground text-sm">
          Define categories and subcategories used in ticket details.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="space-y-2">
              <Label htmlFor="category-name">Category name</Label>
              <Input
                id="category-name"
                placeholder="e.g. Billing"
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
              />
            </div>
            <Button
              className="self-end"
              onClick={() => void handleCreateCategory()}
              disabled={!categoryName.trim()}
            >
              Add category
            </Button>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Parent category</Label>
                <Select
                  value={subcategoryParentId ?? undefined}
                  onValueChange={setSubcategoryParentId}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {subcategoryParentOptions.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="subcategory-name">Subcategory name</Label>
                <Input
                  id="subcategory-name"
                  placeholder="e.g. Payment issue"
                  value={subcategoryName}
                  onChange={(event) => setSubcategoryName(event.target.value)}
                />
              </div>
            </div>
            <Button
              className="self-end"
              onClick={() => void handleCreateSubcategory()}
              disabled={!subcategoryName.trim() || !subcategoryParentId}
            >
              Add subcategory 1
            </Button>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={subcategory2CategoryId ?? undefined}
                  onValueChange={(value) => {
                    setSubcategory2CategoryId(value)
                    setSubcategory2ParentId(null)
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subcategory 1</Label>
                <Select
                  value={subcategory2ParentId ?? undefined}
                  onValueChange={setSubcategory2ParentId}
                  disabled={!subcategory2CategoryId}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue
                      placeholder={
                        subcategory2CategoryId
                          ? "Select subcategory"
                          : "Select category first"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {subcategory2ParentOptions.map((subcategory) => (
                      <SelectItem key={subcategory.id} value={subcategory.id}>
                        {subcategory.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="subcategory-2-name">Subcategory 2 name</Label>
                <Input
                  id="subcategory-2-name"
                  placeholder="e.g. Refund delay"
                  value={subcategory2Name}
                  onChange={(event) => setSubcategory2Name(event.target.value)}
                />
              </div>
            </div>
            <Button
              className="self-end"
              onClick={() => void handleCreateSubcategory2()}
              disabled={
                !subcategory2Name.trim() ||
                !subcategory2ParentId ||
                !subcategory2CategoryId
              }
            >
              Add subcategory 2
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-muted-foreground text-sm">Loading...</div>
          ) : categories.length ? (
            <div className="grid gap-3">
              {categories.map((category) => renderCategory(category))}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">
              No categories configured yet.
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
