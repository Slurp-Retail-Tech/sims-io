-- 042: quotations, and the merchant's PO number, on renewal documents.
--
-- Some companies' finance teams will not pay against a proforma invoice and
-- ask for a quotation instead, and many need their own purchase order number
-- printed on it before they can raise payment.
--
-- A quotation is a proforma in everything but its name: the same payable
-- link, the same lapse, the same tax invoice on payment. So it is not a third
-- document_type, which the open guard, lapse sweep, reconcile job and every
-- aggregate key on. renewal_invoices.issued_as only changes what the document
-- is called and numbered: QUOTATION and QT-{YYYY}/{MM}-{NNN}, from its own
-- counter series.
--
-- renewal_franchise_settings.default_document is what the nightly cycle
-- issues for a franchise; staff can still switch any open document.
--
-- Forward-only and idempotent: each ALTER is guarded through
-- information_schema so a re-run is a no-op.

DROP PROCEDURE IF EXISTS _renewal_quotation_po;

DELIMITER $$

CREATE PROCEDURE _renewal_quotation_po()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_invoices'
      AND COLUMN_NAME = 'issued_as'
  ) THEN
    ALTER TABLE renewal_invoices
      ADD COLUMN issued_as ENUM('proforma','quotation') NOT NULL DEFAULT 'proforma' AFTER document_type,
      ADD COLUMN po_number VARCHAR(64) DEFAULT NULL AFTER issued_as;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_franchise_settings'
      AND COLUMN_NAME = 'default_document'
  ) THEN
    ALTER TABLE renewal_franchise_settings
      ADD COLUMN default_document ENUM('proforma','quotation') NOT NULL DEFAULT 'proforma'
        AFTER default_billing_plan;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'renewal_invoice_sequences'
      AND COLUMN_NAME = 'series'
      AND COLUMN_TYPE LIKE '%''QT''%'
  ) THEN
    ALTER TABLE renewal_invoice_sequences
      MODIFY COLUMN series ENUM('PI','INV','QT') NOT NULL;
  END IF;
END$$

DELIMITER ;

CALL _renewal_quotation_po();
DROP PROCEDURE IF EXISTS _renewal_quotation_po;
