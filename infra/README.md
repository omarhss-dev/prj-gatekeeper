# infra

Infrastructure Azure de GateKeeper, décrite avec Terraform.

## Prérequis (une fois par abonnement)

1. Être connecté : `az login`, avec le bon abonnement actif.
2. Enregistrer à la main les fournisseurs de ressources (opération hors Terraform) :

   ```bash
   for p in Microsoft.App Microsoft.OperationalInsights Microsoft.KeyVault \
            Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL \
            Microsoft.ManagedIdentity Microsoft.Storage Microsoft.Network; do
     az provider register -n "$p"
   done
   ```

3. Créer le stockage du state : `./infra/bootstrap-state.sh <région>`. La région
   doit être autorisée par la policy de l'abonnement.
4. Copier `backend.hcl.example` en `backend.hcl` (ignoré par git) et y mettre les
   valeurs affichées par le script.

Le script donne à ton compte le rôle `Storage Blob Data Contributor` sur le
conteneur du state. Le rôle Owner sur l'abonnement ne suffit pas : il ne donne
aucun accès aux données des blobs.

## Utilisation

```bash
cd infra
terraform init -backend-config=backend.hcl
terraform fmt -recursive .
terraform validate
```

## Verrou du state

Le verrou est un bail posé sur le blob du state. Une opération interrompue
brutalement peut laisser un verrou fantôme : `terraform force-unlock <ID>`,
seulement quand aucune autre opération ne tourne. Ne jamais utiliser `-lock=false`.
