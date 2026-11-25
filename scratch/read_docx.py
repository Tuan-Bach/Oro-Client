import docx

doc_path = r"C:\Users\BACH\Downloads\3D_Cuboid_Annotation_Guideline_V1.docx"
try:
    doc = docx.Document(doc_path)
    print("--- PARAGRAPHS ---")
    for i, p in enumerate(doc.paragraphs):
        if p.text.strip():
            print(f"[{i}] {p.text}")
            
    print("\n--- TABLES ---")
    for t_idx, table in enumerate(doc.tables):
        print(f"\nTable {t_idx}:")
        for row in table.rows:
            cells = [c.text.strip().replace("\n", " ") for c in row.cells]
            print(" | ".join(cells))
except Exception as e:
    print(f"Error reading docx: {e}")
